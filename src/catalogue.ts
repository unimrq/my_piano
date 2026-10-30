import { importScore } from "./importer";
import { applyFingering } from "./fingering";
import { makeXml } from "./notation";
import { roleNote, type Song } from "./model";
interface Entry {
  id: string;
  title: string;
  composer: string;
  difficulty: string;
  category: string;
  focus: string;
  file: string;
  sha256?: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  edition: string;
}
// Bump when importer or notation changes require rebuilding parsed score data.
const parserRevision = "1";
const revisionFor = (catalogue: NonNullable<Song["catalogue"]>) =>
  JSON.stringify([parserRevision, catalogue.file, catalogue.sha256 ?? null]);

export function isCatalogueSongLoaded(song: Song): boolean {
  return (
    !!song.xml &&
    song.notes.length > 0 &&
    (!song.catalogue || song.catalogue.revision === revisionFor(song.catalogue))
  );
}

export async function loadCatalogue(
  cachedSongs: Song[] = [],
  signal?: AbortSignal,
): Promise<Song[]> {
  const response = await fetch("./catalogue/manifest.json", {
    cache: "reload",
    signal,
  });
  if (!response.ok) throw Error("内置曲库索引读取失败");
  const entries: Entry[] = await response.json();
  // The list contains metadata only. Score files are read after choosing a song.
  const personal = Object.values(
    import.meta.glob<Entry[]>("./personal-catalogue.json", {
      eager: true,
      import: "default",
    }),
  ).flat();
  const cachedById = new Map(cachedSongs.map((song) => [song.id, song]));
  return [...personal, ...entries].map((entry) => {
    const cached = cachedById.get(entry.id);
    const catalogue: NonNullable<Song["catalogue"]> = {
      file: entry.file,
      sha256: entry.sha256?.toLowerCase(),
    };
    if (
      catalogue.sha256 &&
      cached?.catalogue?.file === catalogue.file &&
      cached.catalogue.sha256 === catalogue.sha256 &&
      cached.catalogue.revision === revisionFor(catalogue)
    )
      catalogue.revision = cached.catalogue.revision;
    const metadata = {
      id: entry.id,
      title: entry.title,
      source: "builtin" as const,
      composer: entry.composer,
      difficulty: entry.difficulty,
      category: entry.category,
      focus: entry.focus,
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      edition: entry.edition,
      sourceInfo: `${entry.attribution} · ${entry.license}；${entry.edition}`,
    };
    if (
      cached &&
      Object.entries(metadata).every(
        ([key, value]) => cached[key as keyof Song] === value,
      ) &&
      cached.catalogue?.file === catalogue.file &&
      cached.catalogue.sha256 === catalogue.sha256 &&
      cached.catalogue.revision === catalogue.revision
    )
      return cached;
    return {
      ...(cached ?? {
        xml: "",
        notes: [],
        tracks: [],
        measures: [
          { index: 0, label: "1", beat: 0, length: 4, beats: 4, beatType: 4 },
        ],
        tempos: [{ beat: 0, bpm: 120 }],
        duration: 0,
      }),
      ...metadata,
      catalogue,
    };
  });
}

export async function loadCatalogueSong(
  song: Song,
  options: { signal?: AbortSignal; split?: number } = {},
): Promise<Song> {
  const { signal, split = 60 } = options;
  const checkAborted = () => {
    if (signal?.aborted)
      throw signal.reason ?? new DOMException("曲谱读取已取消", "AbortError");
  };
  checkAborted();
  if (!song.catalogue || isCatalogueSongLoaded(song)) return song;
  const response = await fetch("./catalogue/" + song.catalogue.file, {
    cache: "reload",
    signal,
  });
  if (!response.ok) throw Error("曲谱读取失败：" + song.title);
  const bytes = new Uint8Array(await response.arrayBuffer());
  checkAborted();
  if (song.catalogue.sha256 && globalThis.crypto?.subtle) {
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (value) => value.toString(16).padStart(2, "0"),
    ).join("");
    if (hash !== song.catalogue.sha256.toLowerCase())
      throw Error("曲谱校验失败：" + song.title + "，请刷新后重试");
  }
  checkAborted();
  const parsed = importScore(song.catalogue.file, bytes);
  let rolesChanged = false,
    handsChanged = false;
  const tracks = parsed.tracks.map((track) => {
    const previous = song.tracks.find(
      (old) => old.id === track.id && old.name === track.name,
    );
    if (!previous || previous.role === track.role) return track;
    rolesChanged = true;
    return { ...track, role: previous.role };
  });
  const oldNotes = new Map(song.notes.map((note) => [note.id, note]));
  const fingers: Record<string, number> = {};
  let next = { ...parsed, tracks };
  next.notes = parsed.notes.map((note) => {
    const mapped = roleNote(note, next, split);
    if (mapped.hand !== note.hand) handsChanged = true;
    const previous = oldNotes.get(note.id);
    if (
      !note.finger &&
      previous?.finger &&
      previous.midi === note.midi &&
      previous.hand === mapped.hand &&
      previous.beat === note.beat &&
      previous.duration === note.duration
    ) {
      fingers[note.id] = previous.finger;
      return { ...mapped, finger: previous.finger };
    }
    return mapped;
  });
  const fingersChanged = Object.keys(fingers).length > 0;
  if (parsed.source === "midi") {
    if (rolesChanged || handsChanged || fingersChanged)
      next.xml = makeXml(next);
  } else if (fingersChanged)
    next = applyFingering(next, { fingers, skipped: 0 });
  checkAborted();
  return {
    ...song,
    ...next,
    id: song.id,
    title: song.title,
    source: "builtin",
    catalogue: { ...song.catalogue, revision: revisionFor(song.catalogue) },
  };
}
