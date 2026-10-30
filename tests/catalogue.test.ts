// @vitest-environment jsdom
import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { importScore, parseMusicXml } from "../src/importer";
const root = path.resolve("public/catalogue");
const manifest = JSON.parse(
  fs.readFileSync(path.join(root, "manifest.json"), "utf8"),
);
it("现成双手谱原文件未改动，来源、许可与两只手完整", () => {
  expect(manifest).toHaveLength(5);
  expect(new Set(manifest.map((m: any) => m.id)).size).toBe(5);
  const counts = [81, 64, 67, 67, 40];
  for (const [i, m] of manifest.entries()) {
    const bytes = fs.readFileSync(path.join(root, m.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(m.sha256);
    const song = importScore(m.file, bytes);
    expect(song.notes.length, m.title).toBe(counts[i]);
    expect(song.tracks[0].role, m.title).toBe("staff");
    expect(
      song.notes.some((n) => n.hand === "left"),
      m.title,
    ).toBe(true);
    expect(
      song.notes.some((n) => n.hand === "right"),
      m.title,
    ).toBe(true);
    expect(song.xml).toContain("CC0 1.0");
    expect(song.xml).toContain('type="arranger">Noctave');
    expect(
      song.notes.every(
        (n) =>
          n.midi >= 21 &&
          n.midi <= 108 &&
          Number.isFinite(n.beat) &&
          n.duration > 0,
      ),
      m.title,
    ).toBe(true);
    expect(m.license).toBe("CC0 1.0");
    expect(m.difficulty).toBe("入门");
    expect(m.sourceUrl).toMatch(/^https:\/\/noctavepiano.com\/partitions\//);
    expect(m.attribution.length).toBeGreaterThan(3);
  }
});
it("欢乐颂开头旋律及长音低音按原谱保留，摇篮曲弱起不加空拍", () => {
  const load = (i: number) =>
    importScore(
      manifest[i].file,
      fs.readFileSync(path.join(root, manifest[i].file)),
    );
  const ode = load(0);
  expect(
    ode.notes
      .filter((n) => n.hand === "right")
      .slice(0, 8)
      .map((n) => n.midi),
  ).toEqual([64, 64, 65, 67, 67, 65, 64, 62]);
  expect(ode.notes.find((n) => n.hand === "left")).toMatchObject({
    midi: 48,
    beat: 0,
    duration: 4,
  });
  const lullaby = load(2);
  expect(lullaby.measures[0]).toMatchObject({ label: "0", length: 1 });
  expect(lullaby.measures[1].beat).toBe(1);
});
it("内置四首流行 MIDI 保留来源全部音符及原双手声部", () => {
  const allPersonal = JSON.parse(
    fs.readFileSync("src/personal-catalogue.json", "utf8"),
  );
  const originalIds = new Set([
    "personal-moon",
    "personal-name",
    "personal-sunny",
    "personal-porcelain",
  ]);
  const personal = allPersonal.filter((entry: { id: string }) =>
    originalIds.has(entry.id),
  );
  expect(personal).toHaveLength(4);
  expect(
    new Set([...manifest, ...allPersonal].map((entry) => entry.id)).size,
  ).toBe(manifest.length + allPersonal.length);
  for (const entry of personal) {
    const bytes = fs.readFileSync(path.join(root, entry.file));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(entry.sha256);
    const song = importScore(entry.file, bytes);
    expect(song.notes.length, entry.title).toBe(entry.expectedNotes);
    expect(
      song.tracks.map((t) => t.role),
      entry.title,
    ).toEqual(["right", "left"]);
    expect(song.notes.some((n) => n.hand === "right")).toBe(true);
    expect(song.notes.some((n) => n.hand === "left")).toBe(true);
    expect(song.warning).toContain("自动转谱");
    expect(entry.license).not.toMatch(/CC0|MIT/i);
    expect(entry.attribution.length).toBeGreaterThan(0);
    expect(entry.sourceUrl).toMatch(/^https:\/\//);
    const score = parseMusicXml(song.xml, song.title);
    expect(score.notes.length, entry.title).toBe(song.notes.length);
    const source = [...song.notes].sort(
      (a, b) =>
        a.beat - b.beat || a.midi - b.midi || a.hand.localeCompare(b.hand),
    );
    const shown = [...score.notes].sort(
      (a, b) =>
        a.beat - b.beat || a.midi - b.midi || a.hand.localeCompare(b.hand),
    );
    for (const [i, note] of source.entries()) {
      expect(
        [shown[i].midi, shown[i].hand],
        `${entry.title} 第 ${note.measure + 1} 小节`,
      ).toEqual([note.midi, note.hand]);
      expect(Math.abs(shown[i].beat - note.beat)).toBeLessThanOrEqual(0.125001);
      expect(
        Math.abs(shown[i].beat + shown[i].duration - note.beat - note.duration),
      ).toBeLessThanOrEqual(0.125001);
    }
  }
});
it("内置《刻在我心底的名字》339音往返谱面后音高、双手、起音和时值全部保留", () => {
  const bytes = fs.readFileSync(path.join(root, "personal-name.mid"));
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    "65e677cf3085acfb3de864f73f48770e257157b03b45350bd8f68be3c3f2432c",
  );
  const song = importScore("personal-name.mid", bytes);
  const score = parseMusicXml(song.xml, song.title);
  expect(song.notes).toHaveLength(339);
  expect(score.notes).toHaveLength(339);
  const timing = (notes: typeof song.notes) =>
    notes
      .map((n) => ({
        midi: n.midi,
        hand: n.hand,
        beat: Number(n.beat.toFixed(10)),
        duration: Number(n.duration.toFixed(10)),
      }))
      .sort(
        (a, b) =>
          a.beat - b.beat || a.midi - b.midi || a.hand.localeCompare(b.hand),
      );
  expect(timing(score.notes)).toEqual(timing(song.notes));
  expect(song.xml.match(/<time-modification>/g)).toHaveLength(3);
});
