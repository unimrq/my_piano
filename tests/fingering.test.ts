// @vitest-environment jsdom
import { it, expect } from "vitest";
import { planFingering, type FingerNote } from "../src/vendor/pianoplayer";
import { applyFingering, fingeringInput } from "../src/fingering";
import { parseMusicXml } from "../src/importer";
const seq = (
  pitches: number[],
  hand: "left" | "right" = "right",
): FingerNote[] =>
  pitches.map((midi, i) => ({
    id: String(i),
    midi,
    time: i,
    end: i + 0.8,
    hand,
  }));
it("双手五指音型完整，所有建议在1到5范围", () => {
  for (const hand of ["left", "right"] as const) {
    const notes = seq([60, 62, 64, 65, 67], hand);
    const result = planFingering(notes);
    expect(Object.keys(result.fingers)).toHaveLength(5);
    expect(result.skipped).toBe(0);
    for (const f of Object.values(result.fingers))
      expect(f >= 1 && f <= 5).toBe(true);
  }
});
it("和弦不重复用指，左右手次序镜像", () => {
  for (const hand of ["left", "right"] as const) {
    const notes = seq([60, 64, 67], hand).map((n) => ({
      ...n,
      time: 0,
      end: 2,
    }));
    const result = planFingering(notes);
    const f = notes.map((n) => result.fingers[n.id]);
    expect(new Set(f).size).toBe(3);
    expect(
      hand === "right"
        ? f[0] < f[1] && f[1] < f[2]
        : f[0] > f[1] && f[1] > f[2],
    ).toBe(true);
  }
});
it("保持原谱锚点，重复音可以重用手指", () => {
  const notes = seq([60, 60, 60]);
  notes[0].finger = 2;
  const result = planFingering(notes);
  expect(result.fingers["0"]).toBe(2);
  expect(Object.keys(result.fingers)).toHaveLength(3);
});
it("按住的键不能把手指分配给别的键", () => {
  const notes = seq([60, 62]);
  notes[0] = { ...notes[0], end: 3, finger: 1 };
  const result = planFingering(notes);
  expect(result.fingers["1"]).not.toBe(1);
});
it("六音和弦与不可达跨度不编造建议，后续仍可计算", () => {
  const notes = seq([48, 50, 52, 53, 55, 57]).map((n) => ({
    ...n,
    time: 0,
    end: 0.5,
  }));
  notes.push({ id: "later", midi: 60, time: 1, end: 2, hand: "right" });
  const result = planFingering(notes);
  expect(result.skipped).toBe(6);
  expect(result.fingers.later).toBeTruthy();
  expect(
    planFingering(
      seq([21, 108]).map((n) => ({ ...n, time: 0, end: 1 })),
      "S",
    ).skipped,
  ).toBe(2);
});
const xml =
  '<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><rest/><duration>1</duration></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><notations><technical><fingering>2</fingering></technical><slur type="start" number="1"/></notations></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><notations><slur type="stop" number="1"/></notations></note></measure></part></score-partwise>';
it("MusicXML指法写回保留休止符、原指法、连线和音符时序，重复生成不重复标注", () => {
  const song = parseMusicXml(xml, "测试");
  const result = planFingering(fingeringInput(song, 60));
  const next = applyFingering(song, result);
  const parsed = parseMusicXml(next.xml, "测试");
  expect(parsed.notes.map((n) => [n.midi, n.beat, n.duration])).toEqual(
    song.notes.map((n) => [n.midi, n.beat, n.duration]),
  );
  expect(parsed.notes[0].finger).toBe(2);
  expect(parsed.notes[1].finger).toBeTruthy();
  expect(
    new DOMParser()
      .parseFromString(next.xml, "application/xml")
      .querySelectorAll("slur"),
  ).toHaveLength(2);
  expect(applyFingering(next, result).xml.match(/<fingering>/g)).toHaveLength(
    2,
  );
});
it("伴奏和忽略声部不参与指法计算", () => {
  const song = parseMusicXml(xml, "测试");
  song.tracks[0].role = "backing";
  expect(fingeringInput(song, 60)).toEqual([]);
});
