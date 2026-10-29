import { expect, it } from "vitest";
import fs from "node:fs";
import { createHash } from "node:crypto";
it("离线钢琴采样覆盖88键，来源与校验值完整", () => {
  const manifest = JSON.parse(
    fs.readFileSync("public/audio/piano/manifest.json", "utf8"),
  );
  expect(manifest.samples).toHaveLength(30);
  expect(
    manifest.samples.map((sample: { midi: number }) => sample.midi),
  ).toEqual(Array.from({ length: 30 }, (_, i) => 21 + i * 3));
  for (const sample of manifest.samples) {
    const bytes = fs.readFileSync("public/audio/piano/" + sample.file);
    expect(bytes.length).toBe(sample.bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(
      sample.sha256,
    );
    expect(sample.sourceUrl).toContain(
      "efd8296360f9526e379bfbe5c1698ff54d6a1d34",
    );
  }
  expect(
    fs.readFileSync("public/licenses/Salamander-ATTRIBUTION.txt", "utf8"),
  ).toContain("Alexander Holm");
});
