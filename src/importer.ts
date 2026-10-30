// MIDI extraction adapted from Bach to Basics midi.worker.ts, MIT (see NOTICE).
import { Midi } from "@tonejs/midi";
import {
  AsyncUnzipInflate,
  strFromU8,
  Unzip,
  unzipSync,
  type UnzipFile,
} from "fflate";
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
  for (const element of doc.querySelectorAll("*")) {
    if (
      ["script", "iframe", "object", "embed", "foreignobject"].includes(
        element.localName.toLowerCase(),
      ) ||
      Array.from(element.attributes).some((attribute) =>
        /^on/i.test(attribute.localName),
      )
    )
      throw Error("曲谱包含不允许的脚本或事件属性");
  }
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
  const xmlIndices = new Map(
    Array.from(doc.querySelectorAll("part > measure > note")).map(
      (el, index) => [el, index],
    ),
  );
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
                xmlIndex: xmlIndices.get(el),
                finger: /^[1-5]$/.test(
                  el.querySelector("fingering")?.textContent?.trim() ?? "",
                )
                  ? Number(el.querySelector("fingering")!.textContent)
                  : undefined,
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
    if (!root || !Object.hasOwn(files, root)) throw Error("压缩曲谱缺少主文件");
    return parseMusicXml(new TextDecoder().decode(files[root]), title);
  }
  if (ext === "xml" || ext === "musicxml")
    return parseMusicXml(new TextDecoder().decode(bytes), title);
  throw Error("请选择 MIDI、MusicXML 或 MXL 文件");
}

const scoreExtension = /\.(mid|midi|xml|musicxml|mxl)$/i;
type ScoreFile = { name: string; bytes: Uint8Array };
type ZipEntry = { name: string; path: string; size: number; crc: number };
const zipCrcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++)
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  return value >>> 0;
});

function zipCrc(bytes: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (value >>> 8) ^ zipCrcTable[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

function zipDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = bytes.length - 22;
  while (
    end >= Math.max(0, bytes.length - 65557) &&
    view.getUint32(end, true) !== 0x06054b50
  )
    end--;
  if (
    end < 0 ||
    view.getUint32(end, true) !== 0x06054b50 ||
    end + 22 + view.getUint16(end + 20, true) !== bytes.length
  )
    throw Error("ZIP 文件损坏或格式不受支持");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  if (
    view.getUint16(end + 4, true) ||
    view.getUint16(end + 6, true) ||
    count !== view.getUint16(end + 8, true)
  )
    throw Error("不支持分卷 ZIP，请先合并压缩包");
  if (count === 65535 || offset === 0xffffffff)
    throw Error("不支持 ZIP64，请使用普通 ZIP 压缩包");
  const directoryEnd = offset + view.getUint32(end + 12, true);
  if (directoryEnd > end) throw Error("ZIP 文件目录损坏");
  const entries: ZipEntry[] = [];
  const names = new Set<string>();
  for (let i = 0; i < count; i++) {
    if (
      offset + 46 > directoryEnd ||
      view.getUint32(offset, true) !== 0x02014b50
    )
      throw Error("ZIP 文件目录损坏");
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const next =
      offset +
      46 +
      nameLength +
      view.getUint16(offset + 30, true) +
      view.getUint16(offset + 32, true);
    if (next > directoryEnd) throw Error("ZIP 文件目录损坏");
    const name = strFromU8(
      bytes.subarray(offset + 46, offset + 46 + nameLength),
      !(flags & 2048),
    );
    const path = name.replaceAll("\\", "/");
    if (
      /^[a-z]:|^\//i.test(path) ||
      path.split("/").includes("..") ||
      /[\0-\x1f]/.test(path)
    )
      throw Error("ZIP 包含不安全的文件路径");
    if (names.has(path)) throw Error("ZIP 包含重复的文件路径");
    names.add(path);
    const local = view.getUint32(offset + 42, true);
    if (local + 30 > bytes.length || view.getUint32(local, true) !== 0x04034b50)
      throw Error("ZIP 文件头损坏");
    if ((flags | view.getUint16(local + 6, true)) & 65)
      throw Error("不支持加密 ZIP，请先解密压缩包");
    const dataStart =
      local +
      30 +
      view.getUint16(local + 26, true) +
      view.getUint16(local + 28, true);
    if (dataStart + view.getUint32(offset + 20, true) > directoryEnd)
      throw Error("ZIP 文件内容不完整");
    entries.push({
      name,
      path,
      size: view.getUint32(offset + 24, true),
      crc: view.getUint32(offset + 16, true),
    });
    offset = next;
  }
  if (offset !== directoryEnd) throw Error("ZIP 文件目录损坏");
  return entries;
}

export async function unpackScoreFiles(
  name: string,
  bytes: Uint8Array,
): Promise<ScoreFile[]> {
  if (!/\.zip$/i.test(name)) {
    if (!scoreExtension.test(name))
      throw Error("请选择 MIDI、MusicXML、MXL 或 ZIP 文件");
    if (bytes.length > 10 * 1024 * 1024) throw Error("文件超过 10 MB");
    return [{ name, bytes }];
  }
  if (bytes.length > 50 * 1024 * 1024) throw Error("ZIP 文件超过 50 MB");
  const entries = zipDirectory(bytes).filter(
    (entry) =>
      scoreExtension.test(entry.path) &&
      !entry.path.split("/").includes("__MACOSX") &&
      !/(^|\/)\._/.test(entry.path),
  );
  const preferred = entries.some((entry) =>
    entry.path.split("/").slice(0, -1).includes("可直接导入"),
  );
  const selected = entries.filter(
    (entry) =>
      !preferred || entry.path.split("/").slice(0, -1).includes("可直接导入"),
  );
  if (!selected.length) throw Error("ZIP 中没有 MIDI、MusicXML 或 MXL 曲谱");
  if (selected.length > 1000) throw Error("ZIP 中的曲谱超过 1000 首");
  if (selected.some((entry) => entry.size > 10 * 1024 * 1024))
    throw Error("ZIP 中的单首曲谱超过 10 MB");
  if (
    selected.reduce((total, entry) => total + entry.size, 0) >
    100 * 1024 * 1024
  )
    throw Error("ZIP 解压后的曲谱总大小超过 100 MB");
  const allowed = new Map(selected.map((entry) => [entry.name, entry]));
  const files = await new Promise<Map<string, Uint8Array>>(
    (resolve, reject) => {
      const decoded = new Map<string, Uint8Array>();
      const started = new Set<string>();
      const active = new Set<UnzipFile>();
      let failed = false,
        inputDone = false,
        total = 0;
      const fail = (error: Error) => {
        if (failed) return;
        failed = true;
        for (const file of active) file.terminate();
        reject(error);
      };
      const finish = () => {
        if (!failed && inputDone && decoded.size === selected.length)
          resolve(decoded);
      };
      const stream = new Unzip((file) => {
        const entry = allowed.get(file.name);
        if (failed || !entry) return;
        if (started.has(file.name)) {
          fail(Error("ZIP 包含重复的文件路径"));
          return;
        }
        started.add(file.name);
        active.add(file);
        const chunks: Uint8Array[] = [];
        let size = 0;
        file.ondata = (error, chunk, final) => {
          if (failed) return;
          if (error) {
            fail(Error("ZIP 解压失败：" + error.message));
            return;
          }
          size += chunk.length;
          total += chunk.length;
          if (size > 10 * 1024 * 1024) {
            fail(Error("ZIP 中的单首曲谱超过 10 MB"));
            return;
          }
          if (total > 100 * 1024 * 1024) {
            fail(Error("ZIP 解压后的曲谱总大小超过 100 MB"));
            return;
          }
          if (size > entry.size) {
            fail(Error("ZIP 曲谱实际大小与声明不符，文件可能已损坏"));
            return;
          }
          chunks.push(chunk);
          if (final) {
            if (size !== entry.size) {
              fail(Error("ZIP 文件内容不完整"));
              return;
            }
            const value = new Uint8Array(size);
            let offset = 0;
            for (const part of chunks) {
              value.set(part, offset);
              offset += part.length;
            }
            if (zipCrc(value) !== entry.crc) {
              fail(Error("ZIP 曲谱校验失败，文件可能已损坏"));
              return;
            }
            decoded.set(entry.name, value);
            active.delete(file);
            finish();
          }
        };
        file.start();
      });
      stream.register(AsyncUnzipInflate);
      void (async () => {
        try {
          const chunkSize = 16 * 1024;
          for (
            let offset = 0;
            offset < bytes.length && !failed;
            offset += chunkSize
          ) {
            const end = Math.min(offset + chunkSize, bytes.length);
            stream.push(bytes.subarray(offset, end), end === bytes.length);
            if (offset % (chunkSize * 16) === 0)
              await new Promise<void>((done) => setTimeout(done, 0));
          }
          if (failed) return;
          inputDone = true;
          if (started.size !== selected.length)
            fail(Error("ZIP 文件内容不完整"));
          else finish();
        } catch (error) {
          fail(Error("ZIP 解压失败：" + String(error)));
        }
      })();
    },
  );
  const result: ScoreFile[] = [];
  const duplicates = new Map<string, Uint8Array[]>();
  for (const entry of selected) {
    const value = files.get(entry.name)!;
    const key = `${entry.size}:${entry.crc}`;
    const previous = duplicates.get(key) ?? [];
    if (previous.some((other) => value.every((byte, i) => byte === other[i])))
      continue;
    previous.push(value);
    duplicates.set(key, previous);
    result.push({ name: entry.path, bytes: value });
  }
  return result;
}
