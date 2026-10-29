import { parseMusicXml } from "./importer";
import { beatToSeconds, practiceNotes, type Song } from "./model";
import type { FingerNote, FingerResult, HandSize } from "./vendor/pianoplayer";
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
