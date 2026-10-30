// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { Midi } from "@tonejs/midi";
import {
  isCatalogueSongLoaded,
  loadCatalogue,
  loadCatalogueSong,
} from "../src/catalogue";
import { importScore } from "../src/importer";
import { makeXml } from "../src/notation";
import { applyFingering } from "../src/fingering";
import type { Song } from "../src/model";

vi.mock("../src/importer", async (original) => {
  const actual = await original<typeof import("../src/importer")>();
  return { ...actual, importScore: vi.fn(actual.importScore) };
});
vi.mock("../src/notation", async (original) => {
  const actual = await original<typeof import("../src/notation")>();
  return { ...actual, makeXml: vi.fn(actual.makeXml) };
});
vi.mock("../src/fingering", async (original) => {
  const actual = await original<typeof import("../src/fingering")>();
  return { ...actual, applyFingering: vi.fn(actual.applyFingering) };
});

const midi = (pitch = 60) => {
  const value = new Midi();
  value.addTrack().addNote({ midi: pitch, time: 0, duration: 1 });
  return value.toArray();
};
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const metadata = (id: string, bytes: Uint8Array, extension = "mid") => ({
  id,
  file: `${id}.${extension}`,
  sha256: digest(bytes),
  title: `曲目 ${id}`,
  composer: "测试作者",
  difficulty: "入门",
  category: "测试",
  focus: "双手",
  license: "测试数据",
  attribution: "测试",
  sourceUrl: "",
  edition: "测试版本",
});
type Entry = ReturnType<typeof metadata>;
function install(entries: Entry[], files: Map<string, Uint8Array>) {
  const request = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "./catalogue/manifest.json")
      return { ok: true, json: async () => entries } as Response;
    const bytes = files.get(url.replace("./catalogue/", ""));
    return {
      ok: !!bytes,
      status: bytes ? 200 : 404,
      arrayBuffer: async () => bytes!.slice().buffer,
    } as Response;
  });
  vi.stubGlobal("fetch", request);
  return request;
}
const find = (songs: Song[], id: string) =>
  songs.find((song) => song.id === id)!;
const stale = (song: Song): Song => ({
  ...song,
  catalogue: { ...song.catalogue!, revision: "previous-parser" },
});
const xml = new TextEncoder().encode(
  '<score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note></measure></part></score-partwise>',
);

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("crypto", webcrypto);
});
afterEach(() => vi.unstubAllGlobals());

describe("曲库按需加载", () => {
  it("列表只请求索引，所有未点击曲目保持纯元数据", async () => {
    const bytes = midi();
    const request = install(
      [metadata("a", bytes), metadata("b", bytes)],
      new Map(),
    );
    const songs = await loadCatalogue();
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("./catalogue/manifest.json");
    expect(importScore).not.toHaveBeenCalled();
    expect(makeXml).not.toHaveBeenCalled();
    expect(applyFingering).not.toHaveBeenCalled();
    for (const song of songs) {
      expect(song.notes).toEqual([]);
      expect(song.tracks).toEqual([]);
      expect(song.xml).toBe("");
      expect(song.duration).toBe(0);
      expect(song.measures).toHaveLength(1);
      expect(isCatalogueSongLoaded(song)).toBe(false);
    }
  });

  it("点击只读取一首，同页重复点击直接复用解析结果", async () => {
    const bytes = midi();
    const request = install(
      [metadata("a", bytes), metadata("b", bytes)],
      new Map([["a.mid", bytes]]),
    );
    const songs = await loadCatalogue();
    const loaded = await loadCatalogueSong(find(songs, "a"));
    expect(loaded.title).toBe("曲目 a");
    expect(loaded.notes).toHaveLength(1);
    expect(isCatalogueSongLoaded(loaded)).toBe(true);
    expect(isCatalogueSongLoaded(find(songs, "b"))).toBe(false);
    expect(request.mock.calls.map((call) => call[0])).toEqual([
      "./catalogue/manifest.json",
      "./catalogue/a.mid",
    ]);
    expect(request).toHaveBeenLastCalledWith("./catalogue/a.mid", {
      cache: "reload",
      signal: undefined,
    });
    expect(importScore).toHaveBeenCalledTimes(1);
    expect(makeXml).toHaveBeenCalledTimes(1);
    expect(await loadCatalogueSong(loaded)).toBe(loaded);
    expect(request).toHaveBeenCalledTimes(2);
    expect(makeXml).toHaveBeenCalledTimes(1);
  });

  it("重新打开页面只检查索引，已解析曲目不再转谱或重新应用指法", async () => {
    const bytes = midi();
    const request = install(
      [metadata("a", bytes)],
      new Map([["a.mid", bytes]]),
    );
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    request.mockClear();
    vi.mocked(importScore).mockClear();
    vi.mocked(makeXml).mockClear();
    const refreshed = find(await loadCatalogue([loaded]), "a");
    expect(refreshed).toBe(loaded);
    expect(await loadCatalogueSong(refreshed)).toBe(loaded);
    expect(request).toHaveBeenCalledTimes(1);
    expect(importScore).not.toHaveBeenCalled();
    expect(makeXml).not.toHaveBeenCalled();
    expect(applyFingering).not.toHaveBeenCalled();
  });

  it("元信息变更只换元信息，保留原音符、谱面与有效解析标记", async () => {
    const bytes = midi();
    const entries = [metadata("a", bytes)];
    const request = install(entries, new Map([["a.mid", bytes]]));
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    entries[0] = { ...entries[0], title: "新标题", difficulty: "初级" };
    request.mockClear();
    vi.mocked(importScore).mockClear();
    const updated = find(await loadCatalogue([loaded]), "a");
    expect(updated.title).toBe("新标题");
    expect(updated.difficulty).toBe("初级");
    expect(updated.notes).toBe(loaded.notes);
    expect(updated.xml).toBe(loaded.xml);
    expect(isCatalogueSongLoaded(updated)).toBe(true);
    expect(await loadCatalogueSong(updated)).toBe(updated);
    expect(importScore).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("单首来源更新仅使该首失效，未点击时仍不下载", async () => {
    const first = midi(60),
      second = midi(62),
      updated = midi(65);
    const entries = [metadata("a", first), metadata("b", second)];
    const files = new Map([
      ["a.mid", first],
      ["b.mid", second],
    ]);
    const request = install(entries, files);
    const list = await loadCatalogue();
    const a = await loadCatalogueSong(find(list, "a"));
    const b = await loadCatalogueSong(find(list, "b"));
    entries[0] = metadata("a", updated);
    files.set("a.mid", updated);
    request.mockClear();
    vi.mocked(importScore).mockClear();
    const refreshed = await loadCatalogue([a, b]);
    const changed = find(refreshed, "a");
    expect(changed.catalogue?.revision).toBeUndefined();
    expect(changed.notes).toBe(a.notes);
    expect(find(refreshed, "b")).toBe(b);
    expect(request).toHaveBeenCalledTimes(1);
    expect(importScore).not.toHaveBeenCalled();
    const next = await loadCatalogueSong(changed);
    expect(next.notes[0].midi).toBe(65);
    expect(importScore).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[1][0]).toBe("./catalogue/a.mid");
  });

  it("解析版本或文件名变更必须等点击后重新解析", async () => {
    const bytes = midi();
    const entries = [metadata("a", bytes)];
    const request = install(
      entries,
      new Map([
        ["a.mid", bytes],
        ["new.mid", bytes],
      ]),
    );
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    const oldParser = stale(loaded);
    expect(isCatalogueSongLoaded(oldParser)).toBe(false);
    const refreshed = find(await loadCatalogue([oldParser]), "a");
    expect(refreshed.catalogue?.revision).toBeUndefined();
    vi.mocked(importScore).mockClear();
    await loadCatalogueSong(refreshed);
    expect(importScore).toHaveBeenCalledTimes(1);
    entries[0] = { ...entries[0], file: "new.mid" };
    const moved = find(await loadCatalogue([loaded]), "a");
    expect(isCatalogueSongLoaded(moved)).toBe(false);
    expect(moved.xml).toBe(loaded.xml);
    await loadCatalogueSong(moved);
    expect(request).toHaveBeenLastCalledWith(
      "./catalogue/new.mid",
      expect.anything(),
    );
  });

  it("无SHA曲目同页可复用，每次重新获取元数据时重新校验来源", async () => {
    const bytes = midi();
    const entry = { ...metadata("a", bytes), sha256: undefined };
    const request = install(
      [entry as unknown as Entry],
      new Map([["a.mid", bytes]]),
    );
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    expect(await loadCatalogueSong(loaded)).toBe(loaded);
    const refreshed = find(await loadCatalogue([loaded]), "a");
    expect(refreshed.catalogue?.revision).toBeUndefined();
    expect(refreshed.notes).toBe(loaded.notes);
    await loadCatalogueSong(refreshed);
    expect(
      request.mock.calls.filter((call) => call[0] === "./catalogue/a.mid"),
    ).toHaveLength(2);
  });

  it("SHA不符不会修改旧谱面、指法或有效缓存对象", async () => {
    const bytes = midi(60);
    const files = new Map([["a.mid", bytes]]);
    install([metadata("a", bytes)], files);
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    const previous = stale(loaded);
    previous.notes = previous.notes.map((note) => ({ ...note, finger: 3 }));
    const snapshot = structuredClone(previous);
    files.set("a.mid", midi(62));
    await expect(loadCatalogueSong(previous)).rejects.toThrow("校验失败");
    expect(previous).toEqual(snapshot);
    expect(isCatalogueSongLoaded(loaded)).toBe(true);
  });

  it("文件失败与取消不生成解析标记，也不修改已有数据", async () => {
    const bytes = midi();
    const request = install([metadata("a", bytes)], new Map());
    const song = find(await loadCatalogue(), "a");
    await expect(loadCatalogueSong(song)).rejects.toThrow("曲谱读取失败");
    expect(song.catalogue?.revision).toBeUndefined();
    expect(importScore).not.toHaveBeenCalled();
    request.mockClear();
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      loadCatalogueSong(song, { signal: cancelled.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(request).not.toHaveBeenCalled();
    const duringRead = new AbortController();
    request.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => {
        duringRead.abort();
        return bytes.slice().buffer;
      },
    } as Response);
    await expect(
      loadCatalogueSong(song, { signal: duringRead.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(importScore).not.toHaveBeenCalled();
    expect(song.notes).toEqual([]);
  });

  it("用户曲谱直接返回，不触发任何曲库文件读取", async () => {
    const bytes = midi();
    const request = install([], new Map());
    const song = importScore("用户曲目.mid", bytes);
    vi.mocked(importScore).mockClear();
    expect(await loadCatalogueSong(song)).toBe(song);
    expect(isCatalogueSongLoaded(song)).toBe(true);
    expect(request).not.toHaveBeenCalled();
    expect(importScore).not.toHaveBeenCalled();
  });

  it("只保留id和名称兼容的声部设置，并迁移严格匹配的指法", async () => {
    const value = new Midi();
    const right = value.addTrack(),
      left = value.addTrack();
    right.name = "Right";
    left.name = "Left";
    right.addNote({ midi: 72, time: 0, duration: 1 });
    left.addNote({ midi: 48, time: 0, duration: 1 });
    const bytes = value.toArray();
    install([metadata("a", bytes)], new Map([["a.mid", bytes]]));
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    const old = stale(loaded);
    old.tracks = old.tracks.map((track) => ({ ...track, role: "left" }));
    old.notes = old.notes.map((note, index) => ({
      ...note,
      hand: "left",
      finger: index + 1,
    }));
    const result = await loadCatalogueSong(old);
    expect(result.tracks.map((track) => track.role)).toEqual(["left", "left"]);
    expect(result.notes.every((note) => note.hand === "left")).toBe(true);
    expect(result.notes.map((note) => note.finger)).toEqual([1, 2]);
    expect(result.xml).toContain("<fingering>");
    const incompatible = stale(result);
    incompatible.tracks = incompatible.tracks.map((track) => ({
      ...track,
      name: "Changed",
      role: "ignore",
    }));
    const reset = await loadCatalogueSong(incompatible);
    expect(reset.tracks.map((track) => track.role)).toEqual(["right", "left"]);
    expect(reset.notes[0].finger).toBeUndefined();
  });

  it("不向id、音高、起音或时值不同的新音符迁移指法", async () => {
    const bytes = midi();
    install([metadata("a", bytes)], new Map([["a.mid", bytes]]));
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    for (const change of [
      { id: "different" },
      { midi: 61 },
      { beat: 0.25 },
      { duration: 3 },
      { hand: "left" },
    ]) {
      const old = stale(loaded);
      old.notes = [{ ...old.notes[0], finger: 4, ...change }];
      const next = await loadCatalogueSong(old);
      expect(next.notes[0].finger).toBeUndefined();
      expect(next.xml).not.toContain("<fingering>");
    }
  });

  it("仅在单首MusicXML需要迁移缺失指法时修改其显示源XML", async () => {
    install([metadata("a", xml, "musicxml")], new Map([["a.musicxml", xml]]));
    const loaded = await loadCatalogueSong(find(await loadCatalogue(), "a"));
    expect(applyFingering).not.toHaveBeenCalled();
    const old = stale(loaded);
    old.notes = old.notes.map((note, index) => ({
      ...note,
      finger: index ? 5 : 3,
    }));
    const result = await loadCatalogueSong(old);
    expect(applyFingering).toHaveBeenCalledTimes(1);
    expect(result.notes.map((note) => note.finger)).toEqual([3, 5]);
    expect(result.xml).toContain("<fingering>3</fingering>");
    expect(result.xml).toContain("<fingering>5</fingering>");
    expect(loaded.xml).not.toContain("<fingering>");
    expect(await loadCatalogueSong(result)).toBe(result);
    expect(applyFingering).toHaveBeenCalledTimes(1);
  });

  it("单首MIDI按split分手，保留原始演奏音高与时值", async () => {
    const bytes = midi(65);
    install([metadata("a", bytes)], new Map([["a.mid", bytes]]));
    const song = find(await loadCatalogue(), "a");
    const result = await loadCatalogueSong(song, { split: 72 });
    expect(result.notes[0]).toMatchObject({
      midi: 65,
      hand: "left",
      beat: 0,
      duration: 2,
    });
    expect(result.xml).toContain("左手");
  });
});
