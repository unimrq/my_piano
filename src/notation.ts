import type { Note, Song } from "./model";
const escape = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
const lengths = [
  [96, "breve"],
  [48, "whole"],
  [24, "half"],
  [12, "quarter"],
  [6, "eighth"],
  [3, "16th"],
  [1.5, "32nd"],
] as const;
const values = lengths
  .flatMap(([ticks, type]) =>
    [0, 1, 2].map((dots) => ({
      ticks: ticks * (2 - 1 / 2 ** dots),
      type,
      dots,
      triplet: false,
    })),
  )
  .filter((v) => Number.isInteger(v.ticks))
  .concat(
    lengths.map(([ticks, type]) => ({
      ticks: (ticks * 2) / 3,
      type,
      dots: 0,
      triplet: true,
    })),
  )
  .sort((a, b) => b.ticks - a.ticks);
const fragments = (ticks: number, triplet = false) => {
  const out: (typeof values)[number][] = [];
  const tuplet = triplet || ticks % 3 !== 0;
  while (ticks > 0) {
    const value = values.find((v) => v.ticks <= ticks && v.triplet === tuplet);
    if (!value) throw Error("自动转谱出现无法表示的时值");
    out.push(value);
    ticks -= value.ticks;
  }
  return out;
};
const noteType = (value: (typeof values)[number]) =>
  `<type>${value.type}</type>${"<dot/>".repeat(value.dots)}${value.triplet ? "<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>" : ""}`;

// Keep MIDI timing untouched; only the practice score is quantized.
export function makeXml(
  song: Pick<Song, "title" | "notes" | "measures" | "tempos" | "tracks">,
): string {
  const parts = ["right", "left"] as const;
  const tripletGroups = new Map<string, Note[]>();
  for (const n of song.notes) {
    if (
      Math.abs(n.duration - 1 / 3) > 0.001 ||
      Math.abs(n.beat * 3 - Math.round(n.beat * 3)) > 0.001
    )
      continue;
    const key = `${n.track}:${n.hand}:${Math.floor(n.beat + 0.001)}`;
    const group = tripletGroups.get(key) ?? [];
    group.push(n);
    tripletGroups.set(key, group);
  }
  const triplets = new Set<string>();
  for (const group of tripletGroups.values())
    if (new Set(group.map((n) => Math.round(n.beat * 3) % 3)).size === 3)
      for (const n of group) triplets.add(n.id);
  const quantize = (beat: number, triplet: boolean) =>
    triplet ? Math.round(beat * 3) * 4 : Math.round(beat * 4) * 3;

  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(song.title)}</work-title></work><part-list>${parts.map((h, i) => `<score-part id="P${i}"><part-name>${h === "right" ? "右手" : "左手"}</part-name><part-abbreviation>${h === "right" ? "右" : "左"}</part-abbreviation></score-part>`).join("")}</part-list>${parts
    .map((hand, pi) => {
      type Group = {
        start: number;
        end: number;
        notes: Note[];
        triplet: boolean;
        voice: number;
      };
      const chords = new Map<string, Group>();
      for (const n of song.notes) {
        if (
          n.hand !== hand ||
          song.tracks.find((t) => t.id === n.track)?.role === "ignore"
        )
          continue;
        const triplet = triplets.has(n.id);
        const start = quantize(n.beat, triplet);
        const end = Math.max(
          start + (triplet ? 4 : 3),
          quantize(n.beat + n.duration, triplet),
        );
        const key = `${start}:${end}:${triplet}`;
        const group = chords.get(key) ?? {
          start,
          end,
          notes: [],
          triplet,
          voice: 0,
        };
        group.notes.push(n);
        chords.set(key, group);
      }
      const groups = [...chords.values()].sort(
        (a, b) => a.start - b.start || b.notes[0].midi - a.notes[0].midi,
      );
      const ends: number[] = [];
      for (const group of groups) {
        // Equal onsets and lengths share one chord. Genuine overlaps keep a stable
        // voice across the whole piece, so barline ties cannot change voice number.
        let voice = ends.findIndex((end) => end <= group.start);
        if (voice < 0) voice = ends.length;
        ends[voice] = group.end;
        group.voice = voice + 1;
        group.notes.sort((a, b) => a.midi - b.midi);
      }
      return `<part id="P${pi}">${song.measures
        .map((m, mi) => {
          const begin = Math.round(m.beat * 12),
            finish = Math.round((m.beat + m.length) * 12);
          const voices = new Map<number, Group[]>();
          for (const group of groups) {
            if (group.start >= finish || group.end <= begin) continue;
            const voice = voices.get(group.voice) ?? [];
            voice.push(group);
            voices.set(group.voice, voice);
          }
          if (!voices.size) voices.set(1, []);
          const timeChanged =
            mi === 0 ||
            song.measures[mi - 1].beats !== m.beats ||
            song.measures[mi - 1].beatType !== m.beatType;
          return `<measure number="${mi + 1}"><attributes><divisions>12</divisions>${mi === 0 ? "<key><fifths>0</fifths></key>" : ""}${timeChanged ? `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>` : ""}${mi === 0 ? `<clef><sign>${pi === 0 ? "G" : "F"}</sign><line>${pi === 0 ? 2 : 4}</line></clef>` : ""}</attributes>${
            pi === 0
              ? song.tempos
                  .filter((t) => t.beat >= m.beat && t.beat < m.beat + m.length)
                  .map(
                    (t) =>
                      `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(t.bpm)}</per-minute></metronome></direction-type><offset>${Math.round((t.beat - m.beat) * 12)}</offset><sound tempo="${t.bpm}"/></direction>`,
                  )
                  .join("")
              : ""
          }${[...voices]
            .sort(([a], [b]) => a - b)
            .map(([voice, entries], vi) => {
              let cursor = begin;
              const rest = (ticks: number) =>
                fragments(ticks)
                  .map(
                    (value) =>
                      `<note><rest/><duration>${value.ticks}</duration><voice>${voice}</voice>${noteType(value)}</note>`,
                  )
                  .join("");
              let body = vi
                ? `<backup><duration>${finish - begin}</duration></backup>`
                : "";
              for (const group of entries) {
                const start = Math.max(begin, group.start),
                  end = Math.min(finish, group.end);
                if (start > cursor) body += rest(start - cursor);
                let at = start;
                for (const value of fragments(end - start, group.triplet)) {
                  const before = at > group.start,
                    after = at + value.ticks < group.end;
                  const tuplet = group.triplet
                    ? at % 12 === 0
                      ? '<tuplet type="start" number="1"/>'
                      : (at + value.ticks) % 12 === 0
                        ? '<tuplet type="stop" number="1"/>'
                        : ""
                    : "";
                  body += group.notes
                    .map((n, ni) => {
                      const pc = n.midi % 12,
                        step = [
                          "C",
                          "C",
                          "D",
                          "D",
                          "E",
                          "F",
                          "F",
                          "G",
                          "G",
                          "A",
                          "A",
                          "B",
                        ][pc];
                      return `<note>${ni ? "<chord/>" : ""}<pitch><step>${step}</step>${[1, 3, 6, 8, 10].includes(pc) ? "<alter>1</alter>" : ""}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch><duration>${value.ticks}</duration>${before ? '<tie type="stop"/>' : ""}${after ? '<tie type="start"/>' : ""}<voice>${voice}</voice>${noteType(value)}${before || after || tuplet || n.finger ? `<notations>${before ? '<tied type="stop"/>' : ""}${after ? '<tied type="start"/>' : ""}${tuplet}${n.finger && !before ? `<technical><fingering>${n.finger}</fingering></technical>` : ""}</notations>` : ""}</note>`;
                    })
                    .join("");
                  at += value.ticks;
                }
                cursor = end;
              }
              if (cursor < finish) body += rest(finish - cursor);
              return body;
            })
            .join("")}</measure>`;
        })
        .join("")}</part>`;
    })
    .join("")}</score-partwise>`;
}
