export type Role = "right" | "left" | "backing" | "ignore" | "split" | "staff";
export type Hand = "right" | "left" | "both";
export interface Note {
  finger?: number;
  xmlIndex?: number;
  id: string;
  midi: number;
  beat: number;
  duration: number;
  velocity: number;
  track: number;
  measure: number;
  hand: "right" | "left";
}
export interface Track {
  id: number;
  name: string;
  count: number;
  low: number;
  high: number;
  role: Role;
}
export interface Measure {
  index: number;
  beat: number;
  length: number;
  beats: number;
  beatType: number;
  label: string;
}
export interface Tempo {
  beat: number;
  bpm: number;
}
export interface Song {
  id: string;
  title: string;
  source: "builtin" | "midi" | "musicxml";
  xml: string;
  notes: Note[];
  tracks: Track[];
  measures: Measure[];
  tempos: Tempo[];
  duration: number;
  warning?: string;
  sourceInfo?: string;
  difficulty?: string;
  composer?: string;
  category?: string;
  focus?: string;
  license?: string;
  sourceUrl?: string;
  edition?: string;
}
export interface Settings {
  startBeat?: number;
  minWhiteKeys?: number;
  registerMode?: "follow" | "lock" | "full";
  speed: number;
  hand: Hand;
  mode: "wait" | "free" | "rhythm" | "listen";
  loop: boolean;
  from: number;
  to: number;
  metronome: boolean;
  backing: boolean;
  split: number;
  sheetHeight: number;
  inputId: string;
  outputId: string;
}
export const DEFAULT_MIN_WHITE_KEYS = 28;
export const defaults: Settings = {
  minWhiteKeys: DEFAULT_MIN_WHITE_KEYS,
  speed: 75,
  hand: "both",
  mode: "wait",
  loop: false,
  from: 1,
  to: 1,
  metronome: false,
  backing: false,
  split: 60,
  sheetHeight: 34,
  inputId: "",
  outputId: "",
};
export interface Result {
  id: string;
  songId: string;
  title: string;
  date: string;
  seconds: number;
  correct: number;
  wrong: number;
  missed: number;
  accuracy: number;
  problemMeasures: number[];
  offsets: number[];
  mode: string;
  speed: number;
  hand: Hand;
}
export interface Library {
  collection?: "pop-beginner-v1" | "piano-scores-v2";
  version: 1;
  songs: Song[];
  settings: Record<string, Settings>;
  results: Result[];
  lastSong: string;
  favorites?: string[];
  toolbarPosition?: "top" | "bottom";
  showFingering?: boolean;
}
export function selected(n: Note, hand: Hand) {
  return hand === "both" || n.hand === hand;
}
export function roleNote(n: Note, song: Song, split: number): Note {
  const role = song.tracks.find((t) => t.id === n.track)?.role;
  return {
    ...n,
    hand:
      role === "left"
        ? "left"
        : role === "right"
          ? "right"
          : role === "staff"
            ? n.hand
            : n.midi < split
              ? "left"
              : "right",
  };
}
export function practiceNotes(song: Song, s: Pick<Settings, "hand" | "split">) {
  return song.notes
    .filter((n) => {
      const r = song.tracks.find((t) => t.id === n.track)?.role;
      return r !== "ignore" && r !== "backing";
    })
    .map((n) => roleNote(n, song, s.split))
    .filter((n) => selected(n, s.hand));
}
export function playbackNotes(song: Song, s: Settings) {
  if (
    s.mode === "wait" ||
    s.mode === "free" ||
    (s.mode === "rhythm" && !s.backing)
  )
    return [];
  const practiceIds = new Set(practiceNotes(song, s).map((n) => n.id));
  return song.notes.filter((n) => {
    const role = song.tracks.find((t) => t.id === n.track)?.role;
    return (
      role !== "ignore" &&
      (s.mode === "listen" || role === "backing" || !practiceIds.has(n.id))
    );
  });
}
export function beatToSeconds(beat: number, tempos: Tempo[]) {
  let seconds = 0,
    prev = 0,
    bpm = tempos[0]?.bpm ?? 100;
  for (const t of tempos) {
    if (t.beat > beat) break;
    seconds += ((t.beat - prev) * 60) / bpm;
    prev = t.beat;
    bpm = t.bpm;
  }
  return seconds + ((beat - prev) * 60) / bpm;
}
export function secondsToBeat(seconds: number, tempos: Tempo[]) {
  let prev = 0,
    bpm = tempos[0]?.bpm ?? 100;
  for (const t of tempos) {
    const d = ((t.beat - prev) * 60) / bpm;
    if (seconds < d) return prev + (seconds * bpm) / 60;
    seconds -= d;
    prev = t.beat;
    bpm = t.bpm;
  }
  return prev + (seconds * bpm) / 60;
}
export const pitchName = (m: number) =>
  ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"][m % 12] +
  (Math.floor(m / 12) - 1);

// getRandomValues also works on local-network HTTP where randomUUID is absent.
export const newId = () =>
  crypto.randomUUID?.() ??
  Array.from(crypto.getRandomValues(new Uint8Array(16)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
