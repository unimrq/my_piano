// MIDI extraction adapted from Bach to Basics midi.worker.ts, MIT (see NOTICE).
import { Midi } from "@tonejs/midi";
import { unzipSync } from "fflate";
import { newId } from "./model";
import type { Measure, Note, Song, Tempo, Track } from "./model";
import { makeXml } from "./notation";
const id = newId;
const child = (el: Element, tag: string) =>
  Array.from(el.children).find((e) => e.localName === tag);
const val = (el: Element, tag: string, fallback = 0) =>
  Number(child(el, tag)?.textContent ?? fallback);
function xmlDoc(text: string) {
  if (/<!ENTITY/i.test(text)) throw Error("不支持含实体声明的曲谱");
  const doc = new DOMParser().parseFromString(text, "application/xml");
  if (
    doc.querySelector("parsererror") ||
    (doc.documentElement.localName !== "score-partwise" &&
      doc.documentElement.localName !== "container")
  )
    throw Error("不是有效的 MusicXML 文件（需要 score-partwise 格式）");
  return doc;
}
function measuresForMidi(midi: Midi, duration: number): Measure[] {
  let beat = 0,
    index = 0;
  const out: Measure[] = [];
  while (beat < duration && out.length < 20000) {
    const ts = [...midi.header.timeSignatures]
      .reverse()
      .find((t) => t.ticks / midi.header.ppq <= beat);
    const [beats, beatType] = ts?.timeSignature ?? [4, 4];
    const next = midi.header.timeSignatures.find(
      (t) => t.ticks / midi.header.ppq > beat,
    );
    const length = Math.min(
      (beats * 4) / beatType,
      next ? next.ticks / midi.header.ppq - beat : Infinity,
    );
    out.push({ index, beat, length, beats, beatType, label: String(++index) });
    beat += length;
  }
  return out;
}
export function parseMidi(bytes: Uint8Array, title: string): Song {
  const midi = new Midi(bytes);
  const tracks: Track[] = [],
    notes: Note[] = [];
  const nonempty = midi.tracks.filter((t) => t.notes.length);
  let counter = 0;
  nonempty.forEach((t, track) => {
    tracks.push({
      id: track,
      name: t.name || `声部 ${track + 1}`,
      count: t.notes.length,
      low: Math.min(...t.notes.map((n) => n.midi)),
      high: Math.max(...t.notes.map((n) => n.midi)),
      role:
        nonempty.length === 1
          ? "split"
          : track === 0
            ? "right"
            : track === 1
              ? "left"
              : "backing",
    });
    for (const n of t.notes)
      notes.push({
        id: `n${counter++}`,
        midi: n.midi,
        beat: n.ticks / midi.header.ppq,
        duration: n.durationTicks / midi.header.ppq,
        velocity: Math.round(n.velocity * 127),
        track,
        hand:
          nonempty.length === 1
            ? n.midi < 60
              ? "left"
              : "right"
            : track === 0
              ? "right"
              : "left",
        measure: 0,
      });
  });
  if (!notes.length) throw Error("MIDI 文件中没有可练习的音符");
  if (notes.length > 100000) throw Error("音符过多，请先导出需要练习的片段");
  notes.sort((a, b) => a.beat - b.beat);
  const duration = Math.max(...notes.map((n) => n.beat + n.duration));
  const measures = measuresForMidi(midi, duration);
  for (const n of notes)
    n.measure = measures.findLast((m) => m.beat <= n.beat)!.index;
  const tempos = midi.header.tempos.map((t) => ({
    beat: t.ticks / midi.header.ppq,
    bpm: t.bpm,
  }));
  if (tempos[0]?.beat !== 0) tempos.unshift({ beat: 0, bpm: 120 });
  const song: Song = {
    id: id(),
    title,
    source: "midi",
    xml: "",
    notes,
    tracks,
    measures,
    tempos,
    duration,
    warning:
      "自动转谱：按十六分音符量化，保留完整八分三连音；谱面与原版可能不同。",
  };
  song.xml = makeXml(song);
  return song;
}
export function parseMusicXml(text: string, title: string): Song {
  const doc = xmlDoc(text);
  const parts = Array.from(doc.documentElement.children).filter(
    (e) => e.localName === "part",
  );
  if (!parts.length) throw Error("曲谱没有声部");
  const notes: Note[] = [],
    tracks: Track[] = [],
    measures: Measure[] = [],
    tempos: Tempo[] = [{ beat: 0, bpm: 100 }];
  let count = 0,
    warning = "";
  parts.forEach((part, track) => {
    const partId = part.getAttribute("id");
    const name =
      Array.from(doc.querySelectorAll("score-part"))
        .find((e) => e.getAttribute("id") === partId)
        ?.querySelector("part-name")?.textContent || `声部 ${track + 1}`;
    let divisions = 1,
      beats = 4,
      beatType = 4,
      base = 0;
    const ties = new Map<string, Note>();
    const hasStaffAssignment = !!part.querySelector("staff");
    const partMeasures = Array.from(part.children).filter(
      (e) => e.localName === "measure",
    );
    partMeasures.forEach((measure, mi) => {
      let cursor = 0,
        end = 0,
        chordStart = 0;
      const noteStart = notes.length;
      for (const el of Array.from(measure.children)) {
        if (el.localName === "attributes") {
          divisions = val(el, "divisions", divisions);
          const time = child(el, "time");
          if (time) {
            const raw = child(time, "beats")?.textContent ?? "4";
            beats = raw.split("+").reduce((s, v) => s + Number(v), 0);
            beatType = val(time, "beat-type", 4);
          }
          if (child(el, "transpose"))
            warning =
              "本版按谱面音高练习；移调乐器声部请先在制谱软件中转为实音。";
        }
        if (
          divisions <= 0 ||
          !Number.isFinite(divisions) ||
          beats <= 0 ||
          beatType <= 0
        )
          throw Error("曲谱的时值或拍号无效");
        if (el.localName === "backup")
          cursor -= val(el, "duration") / divisions;
        if (el.localName === "forward")
          cursor += val(el, "duration") / divisions;
        if (el.localName === "direction") {
          const sound = el.querySelector("sound[tempo]");
          if (sound) {
            const bpm = Number(sound.getAttribute("tempo"));
            if (bpm > 0)
              tempos.push({
                beat: base + cursor + val(el, "offset") / divisions,
                bpm,
              });
          }
        }
        if (el.localName === "note") {
          if (child(el, "grace")) {
            warning = "装饰音仅显示，不参与判定。";
            continue;
          }
          const chord = !!child(el, "chord"),
            duration = val(el, "duration") / divisions,
            start = chord ? chordStart : cursor;
          if (!chord) chordStart = cursor;
          const pitch = child(el, "pitch");
          if (pitch) {
            const step = child(pitch, "step")?.textContent ?? "C";
            const midi =
              (val(pitch, "octave", 4) + 1) * 12 +
              ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[step] ?? 0) +
              val(pitch, "alter");
            const staff = val(el, "staff", 1);
            const hand =
              parts.length > 1
                ? track === 0
                  ? "right"
                  : "left"
                : hasStaffAssignment
                  ? staff > 1
                    ? "left"
                    : "right"
                  : midi < 60
                    ? "left"
                    : "right";
            const key = `${midi}:${val(el, "voice", 1)}:${staff}`;
            const tieEls = Array.from(el.children).filter(
              (e) => e.localName === "tie",
            );
            const stop = tieEls.some((e) => e.getAttribute("type") === "stop"),
              begin = tieEls.some((e) => e.getAttribute("type") === "start");
            const prev = ties.get(key);
            if (stop && prev)
              prev.duration = Math.max(
                prev.duration,
                base + start + duration - prev.beat,
              );
            else {
              const n: Note = {
                id: `x${count++}`,
                midi,
                beat: base + start,
                duration,
                track,
                hand,
                velocity: 80,
                measure: mi,
              };
              notes.push(n);
              if (begin) ties.set(key, n);
            }
            if (stop && !begin) ties.delete(key);
          }
          if (!chord) cursor += duration;
          end = Math.max(end, cursor, start + duration);
        }
      }
      const normal = (beats * 4) / beatType;
      const len =
        measure.getAttribute("implicit") === "yes"
          ? end || normal
          : Math.max(normal, end);
      if (track === 0)
        measures.push({
          index: mi,
          beat: base,
          length: len,
          beats,
          beatType,
          label: measure.getAttribute("number") || String(mi + 1),
        });
      // Align other parts to the first part, including pickup measures.
      if (track > 0) {
        const target = measures[mi];
        if (!target) throw Error("声部小节数量不一致");
        const delta = target.beat - base;
        for (let n = noteStart; n < notes.length; n++) notes[n].beat += delta;
        base = target.beat + target.length;
      } else base += len;
    });
    const own = notes.filter((n) => n.track === track);
    tracks.push({
      id: track,
      name,
      count: own.length,
      low: own.length ? Math.min(...own.map((n) => n.midi)) : 21,
      high: own.length ? Math.max(...own.map((n) => n.midi)) : 108,
      role:
        parts.length === 1
          ? part.querySelector("staff")
            ? "staff"
            : "split"
          : track === 0
            ? "right"
            : track === 1
              ? "left"
              : "backing",
    });
  });
  if (!notes.length) throw Error("曲谱中没有可练习的音符");
  if (notes.length > 100000) throw Error("曲谱过长，请先导出片段");
  if (
    doc.querySelector("repeat,ending") ||
    doc.querySelector("sound[dacapo],sound[dalsegno],sound[tocoda]")
  )
    warning +=
      (warning ? " " : "") +
      "反复与跳转记号仅显示，练习按谱面顺序进行；需要反复请设置小节循环。";
  notes.sort((a, b) => a.beat - b.beat);
  tempos.sort((a, b) => a.beat - b.beat);
  const unique = tempos.filter((t, i) => tempos[i + 1]?.beat !== t.beat);
  return {
    id: id(),
    title:
      doc.querySelector("work-title")?.textContent ||
      doc.querySelector("movement-title")?.textContent ||
      title,
    source: "musicxml",
    xml: text,
    notes,
    tracks,
    measures,
    tempos: unique,
    duration: Math.max(
      ...notes.map((n) => n.beat + n.duration),
      ...measures.map((m) => m.beat + m.length),
    ),
    warning,
  };
}
export function importScore(name: string, bytes: Uint8Array): Song {
  if (bytes.length > 10 * 1024 * 1024) throw Error("文件超过 10 MB");
  const ext = name.split(".").at(-1)?.toLowerCase();
  const title = name.replace(/\.[^.]+$/, "");
  if (ext === "mid" || ext === "midi") return parseMidi(bytes, title);
  if (ext === "mxl") {
    let total = 0;
    const files = unzipSync(bytes, {
      filter: (f) => {
        total += f.originalSize;
        if (total > 30 * 1024 * 1024) throw Error("解压后的曲谱超过 30 MB");
        return !f.name.endsWith("/");
      },
    });
    const container = files["META-INF/container.xml"];
    if (!container) throw Error("压缩曲谱缺少 container.xml");
    const doc = xmlDoc(new TextDecoder().decode(container));
    const root = doc.querySelector("rootfile")?.getAttribute("full-path");
    if (!root || !files[root]) throw Error("压缩曲谱缺少主文件");
    return parseMusicXml(new TextDecoder().decode(files[root]), title);
  }
  if (ext === "xml" || ext === "musicxml")
    return parseMusicXml(new TextDecoder().decode(bytes), title);
  throw Error("请选择 MIDI、MusicXML 或 MXL 文件");
}
