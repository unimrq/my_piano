import { parseMusicXml } from "./importer";
import { beatToSeconds, practiceNotes, type Song } from "./model";
import type { FingerNote, FingerResult, HandSize } from "./vendor/pianoplayer";

// Simplify the display copy only; the saved score keeps every fingering.
export function compactChordFingerings(doc: Document, split = 60) {
  const parts = [...doc.querySelectorAll("score-partwise > part")];
  const pitch = (note: Element) => {
    const p = note.querySelector("pitch")!;
    return (
      (Number(p.querySelector("octave")?.textContent ?? 4) + 1) * 12 +
      ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[
        p.querySelector("step")?.textContent ?? "C"
      ] ?? 0) +
      Number(p.querySelector("alter")?.textContent ?? 0)
    );
  };
  parts.forEach((part, partIndex) => {
    const hasStaff = !!part.querySelector("staff");
    let divisions = 1;
    for (const measure of part.querySelectorAll("measure")) {
      const chords = new Map<string, { left: boolean; notes: Element[] }>();
      let cursor = 0,
        chordStart = 0;
      for (const note of measure.children) {
        if (note.localName === "attributes")
          divisions = Number(
            note.querySelector("divisions")?.textContent ?? divisions,
          );
        const duration =
          Number(note.querySelector("duration")?.textContent ?? 0) / divisions;
        if (note.localName === "backup") cursor -= duration;
        if (note.localName === "forward") cursor += duration;
        if (note.localName !== "note" || note.querySelector("grace")) continue;
        const start = note.querySelector("chord") ? chordStart : cursor;
        if (!note.querySelector("chord")) {
          chordStart = cursor;
          cursor += duration;
        }
        if (!note.querySelector("pitch") || !note.querySelector("fingering"))
          continue;
        const left =
          parts.length > 1
            ? partIndex > 0
            : hasStaff
              ? Number(note.querySelector("staff")?.textContent ?? 1) > 1
              : pitch(note) < split;
        const key = `${start.toFixed(6)}:${left}`;
        const group = chords.get(key) ?? { left, notes: [] };
        group.notes.push(note);
        chords.set(key, group);
      }
      for (const { left, notes } of chords.values()) {
        notes.sort((a, b) => pitch(a) - pitch(b));
        const anchor = left ? notes[0] : notes.at(-1);
        for (const note of notes)
          if (note !== anchor)
            for (const fingering of note.querySelectorAll("fingering"))
              fingering.remove();
      }
    }
  });
}

export function fingeringInput(song: Song, split: number): FingerNote[] {
  const original = parseMusicXml(song.xml, song.title).notes;
  return practiceNotes(song, { hand: "both", split }).map((n) => ({
    id: n.id,
    midi: n.midi,
    hand: n.hand,
    time: beatToSeconds(n.beat, song.tempos),
    end: beatToSeconds(n.beat + n.duration, song.tempos),
    finger:
      n.finger ??
      original.find(
        (s) =>
          s.midi === n.midi &&
          s.hand === n.hand &&
          Math.abs(s.beat - n.beat) < 0.001,
      )?.finger,
  }));
}
export function applyFingering(song: Song, result: FingerResult): Song {
  const parsed = parseMusicXml(song.xml, song.title);
  const doc = new DOMParser().parseFromString(song.xml, "application/xml");
  const elements = doc.querySelectorAll("part > measure > note");
  const used = new Set<string>();
  for (const n of parsed.notes) {
    const match = song.notes
      .filter(
        (s) =>
          s.midi === n.midi &&
          Math.abs(s.beat - n.beat) <= 0.13 &&
          result.fingers[s.id] &&
          !used.has(s.id),
      )
      .sort(
        (a, b) =>
          Math.abs(a.beat - n.beat) - Math.abs(b.beat - n.beat) ||
          Number(b.hand === n.hand) - Number(a.hand === n.hand),
      )[0];
    if (!match || n.xmlIndex === undefined) continue;
    used.add(match.id);
    const el = elements[n.xmlIndex];
    if (el.querySelector("fingering")) continue;
    const node = (tag: string) => doc.createElementNS(el.namespaceURI, tag);
    let notations = el.querySelector("notations");
    if (!notations) {
      notations = node("notations");
      el.append(notations);
    }
    let technical = notations.querySelector("technical");
    if (!technical) {
      technical = node("technical");
      notations.append(technical);
    }
    const finger = node("fingering");
    finger.textContent = String(result.fingers[match.id]);
    technical.append(finger);
  }
  return {
    ...song,
    xml: new XMLSerializer().serializeToString(doc),
    notes: song.notes.map((n) => ({
      ...n,
      finger: n.finger ?? result.fingers[n.id],
    })),
  };
}
export function generateFingering(
  song: Song,
  split: number,
  size: HandSize,
): Promise<{ song: Song; skipped: number }> {
  const notes = fingeringInput(song, split);
  const worker = new Worker(new URL("./fingering.worker.ts", import.meta.url), {
    type: "module",
  });
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.error) reject(Error(event.data.error));
      else {
        try {
          resolve({
            song: applyFingering(song, event.data.result),
            skipped: event.data.result.skipped,
          });
        } catch (error) {
          reject(error);
        }
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(Error("指法生成失败，请重试"));
    };
    worker.postMessage({ notes, size });
  });
}
