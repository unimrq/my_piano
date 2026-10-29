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
// Local MIDI-to-score reconstruction. Keep complete eighth-note triplets;
// otherwise quantize to sixteenths, splitting barlines with ties.
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
    triplet ? Math.round(beat * 3) / 3 : Math.round(beat * 4) / 4;
  return `<?xml version="1.0" encoding="utf-8"?><score-partwise version="4.0"><work><work-title>${escape(song.title)}</work-title></work><part-list>${parts.map((h, i) => `<score-part id="P${i}"><part-name>${h === "right" ? "右手" : "左手"}</part-name><part-abbreviation>${h === "right" ? "右" : "左"}</part-abbreviation></score-part>`).join("")}</part-list>${parts
    .map(
      (hand, pi) =>
        `<part id="P${pi}">${song.measures
          .map((m, mi) => {
            const active = song.notes.filter(
              (n) =>
                n.hand === hand &&
                song.tracks.find((t) => t.id === n.track)?.role !== "ignore",
            );
            const pieces = active
              .map((n) => ({
                ...n,
                triplet: triplets.has(n.id),
                start: Math.max(m.beat, quantize(n.beat, triplets.has(n.id))),
                end: Math.min(
                  m.beat + m.length,
                  Math.max(
                    quantize(n.beat + n.duration, triplets.has(n.id)),
                    quantize(n.beat, triplets.has(n.id)) + 0.25,
                  ),
                ),
              }))
              .filter(
                (n) =>
                  n.start < n.end &&
                  n.beat < m.beat + m.length &&
                  n.beat + n.duration > m.beat,
              );
            // Independent voices retain overlapping notes and rests without lossy truncation.
            const voices: (typeof pieces)[] = [];
            for (const n of pieces.sort(
              (a, b) => a.start - b.start || a.midi - b.midi,
            )) {
              const voice = voices.find(
                (v) => v.at(-1)!.end <= n.start + 0.001,
              );
              if (voice) voice.push(n);
              else voices.push([n]);
            }
            if (!voices.length) voices.push([]);
            const timeChanged =
              mi === 0 ||
              song.measures[mi - 1].beats !== m.beats ||
              song.measures[mi - 1].beatType !== m.beatType;
            return `<measure number="${mi + 1}"><attributes><divisions>12</divisions>${mi === 0 ? "<key><fifths>0</fifths></key>" : ""}${timeChanged ? `<time><beats>${m.beats}</beats><beat-type>${m.beatType}</beat-type></time>` : ""}${mi === 0 ? `<clef><sign>${pi === 0 ? "G" : "F"}</sign><line>${pi === 0 ? 2 : 4}</line></clef>` : ""}</attributes>${
              pi === 0
                ? song.tempos
                    .filter(
                      (t) => t.beat >= m.beat && t.beat < m.beat + m.length,
                    )
                    .map(
                      (t) =>
                        `<direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>${Math.round(t.bpm)}</per-minute></metronome></direction-type><offset>${Math.round((t.beat - m.beat) * 12)}</offset><sound tempo="${t.bpm}"/></direction>`,
                    )
                    .join("")
                : ""
            }${voices
              .map((voice, vi) => {
                let cursor = m.beat;
                const rest = (d: number) =>
                  `<note><rest/><duration>${Math.round(d * 12)}</duration><voice>${vi + 1}</voice></note>`;
                let body = vi
                  ? `<backup><duration>${Math.round(m.length * 12)}</duration></backup>`
                  : "";
                for (const n of voice) {
                  if (n.start > cursor + 0.001) body += rest(n.start - cursor);
                  const pc = n.midi % 12;
                  const step = [
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
                  const sharp = [1, 3, 6, 8, 10].includes(pc);
                  const before = n.beat < m.beat - 0.001,
                    after = n.beat + n.duration > m.beat + m.length + 0.001;
                  const tuplet = n.triplet
                    ? Math.round(n.start * 3) % 3 === 0
                      ? '<tuplet type="start" number="1"/>'
                      : Math.round(n.end * 3) % 3 === 0
                        ? '<tuplet type="stop" number="1"/>'
                        : ""
                    : "";
                  body += `<note><pitch><step>${step}</step>${sharp ? "<alter>1</alter>" : ""}<octave>${Math.floor(n.midi / 12) - 1}</octave></pitch><duration>${Math.round((n.end - n.start) * 12)}</duration>${before ? '<tie type="stop"/>' : ""}${after ? '<tie type="start"/>' : ""}<voice>${vi + 1}</voice>${n.triplet ? "<type>eighth</type><time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes><normal-type>eighth</normal-type></time-modification>" : ""}${before || after || tuplet ? `<notations>${before ? '<tied type="stop"/>' : ""}${after ? '<tied type="start"/>' : ""}${tuplet}</notations>` : ""}</note>`;
                  cursor = n.end;
                }
                if (cursor < m.beat + m.length - 0.001)
                  body += rest(m.beat + m.length - cursor);
                return body;
              })
              .join("")}</measure>`;
          })
          .join("")}</part>`,
    )
    .join("")}</score-partwise>`;
}
