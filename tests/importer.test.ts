// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { Midi } from "@tonejs/midi";
import { zipSync, strToU8 } from "fflate";
import { importScore, parseMusicXml, unpackScoreFiles } from "../src/importer";
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
    expect(doc.querySelectorAll("note > time-modification")).toHaveLength(3);
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
  it("同时同长的音合为和弦，跨小节长音不改变声部或多出起音", () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    const track = midi.addTrack();
    for (const pitch of [84, 88])
      track.addNote({ midi: pitch, ticks: 0, durationTicks: ppq / 2 });
    track.addNote({ midi: 84, ticks: ppq * 3, durationTicks: ppq });
    track.addNote({ midi: 72, ticks: ppq * 3.5, durationTicks: ppq * 6.5 });
    track.addNote({ midi: 76, ticks: ppq * 4, durationTicks: ppq });
    const song = importScore("和弦延音.mid", midi.toArray());
    const before = structuredClone(song.notes);
    const score = parseMusicXml(song.xml, song.title);
    const timing = (notes: typeof song.notes) =>
      notes
        .map((n) => [n.midi, n.beat, n.duration])
        .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(timing(score.notes)).toEqual(timing(song.notes));
    expect(score.notes.filter((n) => n.midi === 72)).toHaveLength(1);
    expect(score.notes.find((n) => n.midi === 72)?.duration).toBe(6.5);
    const doc = new DOMParser().parseFromString(song.xml, "application/xml");
    expect(doc.querySelectorAll("chord")).toHaveLength(1);
    const chord = doc.querySelector("chord")!.parentElement!;
    expect(chord.querySelector("voice")?.textContent).toBe(
      chord.previousElementSibling!.querySelector("voice")?.textContent,
    );
    expect(song.notes).toEqual(before);
  });
  it("非标准组合时值拆为合法音符并连线，量化跨小节边界不丢音", () => {
    const midi = new Midi();
    const ppq = midi.header.ppq;
    const track = midi.addTrack();
    track.addNote({ midi: 72, ticks: 0, durationTicks: ppq * 2.75 });
    track.addNote({ midi: 76, ticks: ppq * 3.95, durationTicks: ppq * 0.5 });
    const song = importScore("量化边界.mid", midi.toArray());
    const score = parseMusicXml(song.xml, song.title);
    expect(score.notes.map((n) => [n.midi, n.beat, n.duration])).toEqual([
      [72, 0, 2.75],
      [76, 4, 0.5],
    ]);
    const doc = new DOMParser().parseFromString(song.xml, "application/xml");
    expect(doc.querySelectorAll("time-modification")).toHaveLength(0);
    expect(doc.querySelectorAll('tie[type="start"]').length).toBeGreaterThan(0);
    expect(
      [...doc.querySelectorAll("note")].every((n) => n.querySelector("type")),
    ).toBe(true);
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

describe("ZIP 曲谱包", () => {
  const midi = () => {
    const value = new Midi();
    value.addTrack().addNote({ midi: 60, time: 0, duration: 1 });
    return value.toArray();
  };
  const changeDirectory = (
    bytes: Uint8Array,
    update: (view: DataView, offset: number) => void,
  ) => {
    const copy = bytes.slice();
    const view = new DataView(copy.buffer);
    for (let offset = 0; offset + 46 <= copy.length; offset++)
      if (view.getUint32(offset, true) === 0x02014b50) update(view, offset);
    return copy;
  };

  it("单文件原样传递，MXL 不作为曲谱包拆开", async () => {
    const bytes = midi();
    expect(await unpackScoreFiles("单曲.mid", bytes)).toEqual([
      { name: "单曲.mid", bytes },
    ]);
    const mxl = zipSync({
      "META-INF/container.xml": strToU8(
        '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
      ),
      "score.xml": strToU8(score),
    });
    const files = await unpackScoreFiles("原谱.mxl", mxl);
    expect(files).toHaveLength(1);
    expect(files[0].bytes).toEqual(mxl);
    expect(importScore(files[0].name, files[0].bytes).notes).toHaveLength(3);
    await expect(unpackScoreFiles("说明.txt", strToU8("x"))).rejects.toThrow(
      "ZIP",
    );
  });

  it("读取多目录曲谱并忽略辅助文件、Mac 元数据与嵌套 ZIP", async () => {
    const zip = zipSync({
      "分类/测试.mid": midi(),
      "原谱/测试.musicxml": strToU8(score),
      "说明.txt": strToU8("readme"),
      "目录.csv": strToU8("title,file"),
      "__MACOSX/._测试.mid": strToU8("metadata"),
      "原谱/._测试.musicxml": strToU8("metadata"),
      "其他曲库.zip": zipSync({ "曲目.mid": midi() }),
    });
    const files = await unpackScoreFiles("曲库.ZIP", zip);
    expect(files.map((file) => file.name)).toEqual([
      "分类/测试.mid",
      "原谱/测试.musicxml",
    ]);
    expect(importScore("测试.mid", files[0].bytes).notes).toHaveLength(1);
    expect(importScore("测试.musicxml", files[1].bytes).notes).toHaveLength(3);
  });

  it("个人曲谱包仅导入可直接导入目录，避免备份与异常曲谱重复入库", async () => {
    const zip = zipSync({
      "完美钢琴曲谱/可直接导入/中文流行/曲目.mid": midi(),
      "完美钢琴曲谱/MIDI备份/备份.mid": midi(),
      "完美钢琴曲谱/需检查/损坏.mid": strToU8("bad"),
      "完美钢琴曲谱/原谱其他版本/版本.musicxml": strToU8(score),
      "完美钢琴曲谱/来源与校验.json": strToU8("{}"),
    });
    const files = await unpackScoreFiles("完美钢琴.zip", zip);
    expect(files.map((file) => file.name)).toEqual([
      "完美钢琴曲谱/可直接导入/中文流行/曲目.mid",
    ]);
  });

  it("按文件字节去重，保留不同的编配文件", async () => {
    const bytes = midi();
    const files = await unpackScoreFiles(
      "重复.zip",
      zipSync({
        "歌曲.mid": bytes,
        "备份/歌曲.mid": bytes,
        "不同编配.xml": strToU8(score),
      }),
    );
    expect(files.map((file) => file.name)).toEqual([
      "歌曲.mid",
      "不同编配.xml",
    ]);
  });

  it("空包、损坏包、加密包及校验不符会明确报错", async () => {
    await expect(unpackScoreFiles("空.zip", zipSync({}))).rejects.toThrow(
      "没有",
    );
    await expect(
      unpackScoreFiles("只有说明.zip", zipSync({ "说明.txt": strToU8("x") })),
    ).rejects.toThrow("没有");
    await expect(
      unpackScoreFiles("坏.zip", new Uint8Array([1, 2, 3])),
    ).rejects.toThrow("损坏");
    const zip = zipSync({ "测试.mid": midi() }, { level: 0 });
    const encrypted = changeDirectory(zip, (view, offset) =>
      view.setUint16(offset + 8, view.getUint16(offset + 8, true) | 1, true),
    );
    await expect(unpackScoreFiles("加密.zip", encrypted)).rejects.toThrow(
      "加密",
    );
    const corrupted = changeDirectory(zip, (view, offset) =>
      view.setUint32(offset + 16, 0, true),
    );
    await expect(unpackScoreFiles("损坏.zip", corrupted)).rejects.toThrow(
      "校验失败",
    );
  });

  it("拒绝绝对路径及正反斜杠路径穿越", async () => {
    for (const name of [
      "../曲目.mid",
      "目录/../../曲目.mid",
      "..\\曲目.mid",
      "/曲目.mid",
      "C:\\曲目.mid",
    ]) {
      await expect(
        unpackScoreFiles("不安全.zip", zipSync({ [name]: midi() })),
      ).rejects.toThrow("路径");
    }
    const files = await unpackScoreFiles(
      "Windows路径.zip",
      zipSync({ "分类\\曲目.mid": midi() }),
    );
    expect(files[0].name).toBe("分类/曲目.mid");
  });

  it("拒绝伪造原始大小和前缀 CRC 的压缩流，不能静默截断成有效 MIDI", async () => {
    const clean = midi();
    const expanded = new Uint8Array(1024 * 1024).fill(65);
    expanded.set(clean);
    const prefixZip = zipSync({ "曲目.mid": clean });
    let prefixCrc = 0;
    changeDirectory(prefixZip, (view, offset) => {
      prefixCrc = view.getUint32(offset + 16, true);
    });
    const forged = changeDirectory(
      zipSync({ "曲目.mid": expanded }),
      (view, offset) => {
        view.setUint32(offset + 24, clean.length, true);
        view.setUint32(offset + 16, prefixCrc, true);
        // Both headers agree, but the actual DEFLATE stream expands to 1 MiB.
        const local = view.getUint32(offset + 42, true);
        view.setUint32(local + 22, clean.length, true);
        view.setUint32(local + 14, prefixCrc, true);
      },
    );
    await expect(unpackScoreFiles("伪造大小.zip", forged)).rejects.toThrow(
      "实际大小与声明不符",
    );
  });

  it("在分配解压内存之前限制单曲大小、总大小及曲目数量", async () => {
    const zip = zipSync({ "曲目.mid": midi() });
    const tooLarge = changeDirectory(zip, (view, offset) =>
      view.setUint32(offset + 24, 10 * 1024 * 1024 + 1, true),
    );
    await expect(unpackScoreFiles("大曲目.zip", tooLarge)).rejects.toThrow(
      "单首曲谱超过 10 MB",
    );
    const many = Object.fromEntries(
      Array.from({ length: 1001 }, (_, index) => [`${index}.mid`, midi()]),
    );
    await expect(unpackScoreFiles("太多.zip", zipSync(many))).rejects.toThrow(
      "超过 1000",
    );
    const total = changeDirectory(
      zipSync(
        Object.fromEntries(
          Array.from({ length: 11 }, (_, i) => [`${i}.mid`, midi()]),
        ),
      ),
      (view, offset) => view.setUint32(offset + 24, 10 * 1024 * 1024, true),
    );
    await expect(unpackScoreFiles("解压过大.zip", total)).rejects.toThrow(
      "总大小超过 100 MB",
    );
    await expect(
      unpackScoreFiles("压缩包过大.zip", new Uint8Array(50 * 1024 * 1024 + 1)),
    ).rejects.toThrow("ZIP 文件超过 50 MB");
  });
});
