// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { zipSync, strToU8 } from "fflate";
import { importScore, parseMusicXml } from "../src/importer";
import { demos } from "../src/demos";
import { makeXml } from "../src/notation";
const score = `<score-partwise version="4.0"><work><work-title>测试</work-title></work><part-list><score-part id="P1"><part-name>钢琴</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>2</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes><direction><sound tempo="90"/></direction><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/></note><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration></note><note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`;
describe("离线导入", () => {
  it("多轨 MIDI 保留速度、音高和声部预览", () => {
    const midi = new Midi();
    midi.header.setTempo(90);
    midi.addTrack().addNote({ midi: 64, time: 0, duration: 0.5 });
    midi.addTrack().addNote({ midi: 48, time: 0, duration: 1 });
    const song = importScore("测试.mid", midi.toArray());
    expect(song.notes.map((n) => n.midi)).toEqual([64, 48]);
    expect(song.tracks.map((t) => t.role)).toEqual(["right", "left"]);
    expect(song.tempos[0].bpm).toBeCloseTo(90, 3);
    expect(song.xml).toContain("score-partwise");
  });
  it("单轨默认中央 C 分手", () => {
    const midi = new Midi();
    midi
      .addTrack()
      .addNote({ midi: 59, time: 0, duration: 1 })
      .addNote({ midi: 60, time: 1, duration: 1 });
    const song = importScore("solo.midi", midi.toArray());
    expect(song.tracks[0].role).toBe("split");
    expect(song.notes.map((n) => n.hand)).toEqual(["left", "right"]);
  });
  it("整拍八分三连音保留精确起音与时值，谱面标明三连音", () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    const right = midi.addTrack();
    for (const [i, pitch] of [71, 72, 74].entries())
      right.addNote({
        midi: pitch,
        ticks: ppq * 3 + (ppq * i) / 3,
        durationTicks: ppq / 3,
      });
    midi.addTrack().addNote({ midi: 55, ticks: ppq * 3, durationTicks: ppq });
    const song = importScore("三连音.mid", midi.toArray());
    const before = structuredClone(song.notes);
    const score = parseMusicXml(makeXml(song), "三连音");
    const notes = score.notes.filter((n) => n.hand === "right");
    expect(notes.map((n) => n.midi)).toEqual([71, 72, 74]);
    for (const [i, n] of notes.entries()) {
      expect(n.beat).toBeCloseTo(3 + i / 3, 10);
      expect(n.duration).toBeCloseTo(1 / 3, 10);
    }
    expect(score.notes.find((n) => n.hand === "left")).toMatchObject({
      midi: 55,
      beat: 3,
      duration: 1,
    });
    const doc = new DOMParser().parseFromString(song.xml, "application/xml");
    expect(doc.querySelectorAll("note > type")).toHaveLength(3);
    for (const note of doc.querySelectorAll("time-modification")) {
      expect(note.querySelector("actual-notes")?.textContent).toBe("3");
      expect(note.querySelector("normal-notes")?.textContent).toBe("2");
    }
    expect(doc.querySelectorAll('tuplet[type="start"]')).toHaveLength(1);
    expect(doc.querySelectorAll('tuplet[type="stop"]')).toHaveLength(1);
    expect(song.notes).toEqual(before);
  });
  it("普通 MIDI 仍按十六分量化，孤立的三分之一拍不误判成完整三连音", () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    midi
      .addTrack()
      .addNote({ midi: 64, ticks: ppq / 3, durationTicks: ppq / 3 })
      .addNote({ midi: 67, ticks: ppq + 20, durationTicks: 170 });
    const song = importScore("普通.mid", midi.toArray());
    const score = parseMusicXml(song.xml, "普通");
    expect(score.notes.map((n) => [n.midi, n.beat, n.duration])).toEqual([
      [64, 0.25, 0.5],
      [67, 1, 0.5],
    ]);
    expect(song.xml).not.toContain("time-modification");
    expect(song.notes[0].beat).toBeCloseTo(1 / 3, 10);
    expect(song.notes[0].duration).toBeCloseTo(1 / 3, 10);
  });
  it("空 MIDI 与损坏文件明确失败", () => {
    expect(() => importScore("empty.mid", new Midi().toArray())).toThrow(
      "没有",
    );
    expect(() => importScore("bad.mid", new Uint8Array([1, 2, 3]))).toThrow();
    expect(() => importScore("bad.xml", strToU8("<bad>"))).toThrow("有效");
  });
  it("MusicXML 保留原文、和弦与延音线起音", () => {
    const s = parseMusicXml(score, "test");
    expect(s.xml).toBe(score);
    expect(s.title).toBe("测试");
    expect(s.notes.map((n) => [n.midi, n.beat, n.duration])).toEqual([
      [60, 0, 2],
      [64, 2, 2],
      [67, 2, 2],
    ]);
    expect(s.tempos[0].bpm).toBe(90);
  });
  it("MXL 按 container 指定主文件，支持压缩", () => {
    const zip = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="score.musicxml"/></rootfiles></container>',
      ),
      "score.musicxml": strToU8(score),
    });
    expect(importScore("test.mxl", zip).notes).toHaveLength(3);
  });
  it("拒绝无主文件的 MXL 和实体声明", () => {
    expect(() =>
      importScore("bad.mxl", zipSync({ "x.xml": strToU8(score) })),
    ).toThrow("container");
    expect(() => parseMusicXml('<!ENTITY boom "x">' + score, "x")).toThrow(
      "实体",
    );
  });
  it("反复记号明确提示线性练习", () => {
    const s = parseMusicXml(
      score.replace(
        "</measure>",
        '<barline><repeat direction="backward"/></barline></measure>',
      ),
      "x",
    );
    expect(s.warning).toContain("谱面顺序");
  });
  it("五首示范谱可往返解析且长音跨小节保留延音", () => {
    for (const song of demos()) {
      expect(parseMusicXml(song.xml, song.title).notes.length).toBeGreaterThan(
        5,
      );
    }
    const song = demos()[0];
    song.notes = [{ ...song.notes[0], beat: 3, duration: 3 }];
    const s = parseMusicXml(makeXml(song), "长音");
    expect(s.notes[0].duration).toBe(3);
    expect(s.notes).toHaveLength(1);
  });
  it("XML backup 多声部不会误算为串行", () => {
    const s = parseMusicXml(
      score.replace(
        "</measure>",
        "<backup><duration>8</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>8</duration><voice>2</voice><staff>2</staff></note></measure>",
      ),
      "x",
    );
    expect(s.notes.find((n) => n.midi === 48)?.beat).toBe(0);
  });
  it("双手谱按原谱表分手，右手低音与左手高音不按中央 C 错分", () => {
    const s = parseMusicXml(
      `<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time></attributes><note><pitch><step>B</step><octave>3</octave></pitch><duration>4</duration><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><staff>2</staff></note></measure></part></score-partwise>`,
      "双手谱",
    );
    expect(s.tracks[0].role).toBe("staff");
    expect(s.notes.map((n) => [n.midi, n.hand])).toEqual([
      [59, "right"],
      [62, "left"],
    ]);
  });
  it("tempo map 与拍号变化被读取", () => {
    const s = parseMusicXml(
      score.replace(
        "</part>",
        '<measure number="2"><attributes><time><beats>3</beats><beat-type>8</beat-type></time></attributes><direction><sound tempo="120"/></direction><note><pitch><step>D</step><octave>4</octave></pitch><duration>3</duration></note></measure></part>',
      ),
      "x",
    );
    expect(s.measures[1]).toMatchObject({
      beat: 4,
      length: 1.5,
      beats: 3,
      beatType: 8,
    });
    expect(s.tempos.at(-1)).toEqual({ beat: 4, bpm: 120 });
  });
});
it("拒绝实体展开、脚本和事件属性，包括带命名空间的脚本", () => {
  const attacks = [
    "<script>alert(1)</script>",
    '<evil:script xmlns:evil="urn:evil">alert(1)</evil:script>',
    '<direction onload="alert(1)"/>',
    "<foreignObject><iframe/></foreignObject>",
  ];
  for (const payload of attacks)
    expect(() =>
      parseMusicXml(
        score.replace("</measure>", payload + "</measure>"),
        "恶意曲谱",
      ),
    ).toThrow(/脚本|事件/);
  expect(() =>
    parseMusicXml(
      '<!DOCTYPE score-partwise [<!ENTITY x "payload">]>' + score,
      "实体",
    ),
  ).toThrow(/实体/);
});
