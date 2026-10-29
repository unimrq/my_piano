import { describe, it, expect } from "vitest";
import { Trainer } from "../src/trainer";
import {
  defaults,
  beatToSeconds,
  secondsToBeat,
  type Song,
} from "../src/model";
const fixture = (pitches = [60, 60, 62], beats = [0, 1, 2]): Song => ({
  id: "test",
  title: "test",
  source: "midi",
  xml: "",
  notes: pitches.map((midi, i) => ({
    id: String(i),
    midi,
    beat: beats[i],
    duration: 0.5,
    velocity: 80,
    track: 0,
    measure: Math.floor(beats[i] / 4),
    hand: "right",
  })),
  tracks: [
    { id: 0, name: "piano", count: 3, low: 60, high: 64, role: "right" },
  ],
  tempos: [{ beat: 0, bpm: 60 }],
  measures: [
    { index: 0, label: "1", beat: 0, length: 4, beats: 4, beatType: 4 },
    { index: 1, label: "2", beat: 4, length: 4, beats: 4, beatType: 4 },
  ],
  duration: 8,
});
const trainer = (s = fixture(), patch = {}) =>
  new Trainer(s, { ...defaults, speed: 100, to: 1, ...patch });
describe("等待模式", () => {
  it.each([25, 50, 100, 150])(
    "%i%% 速度都可以立即弹下一音，也可以任意停顿",
    (speed) => {
      const e = trainer(fixture([60, 62, 64], [0, 2, 3]), { speed });
      e.startRun(0);
      e.down(60, 80, 10);
      expect(e.beat).toBe(2);
      e.down(62, 80, 20);
      expect(e.stats.correct).toBe(2);
      expect(e.stats.wrong).toBe(0);
      e.update(60000);
      expect(e.beat).toBe(3);
      expect(e.done).toBe(false);
      e.down(64, 80, 60001);
      expect(e.stats.correct).toBe(3);
      expect(e.done).toBe(true);
      expect(e.beat).toBe(e.end);
    },
  );
  it("跳过开头休止与组间休止，不等待时间到达", () => {
    const e = trainer(fixture([60, 62], [1, 3]));
    expect(e.beat).toBe(1);
    e.startRun(0);
    e.down(60, 80, 0);
    e.down(62, 80, 1);
    expect(e.stats.correct).toBe(2);
    expect(e.stats.wrong).toBe(0);
  });
  it("跨小节和循环边界仍可连续弹，下一轮从首个目标开始", () => {
    const s = fixture([60, 62, 64], [2, 3, 4]);
    const e = trainer(s, { loop: true });
    e.startRun(0);
    e.down(60, 80, 0);
    e.up(60, 1);
    e.down(62, 80, 2);
    expect(e.done).toBe(true);
    expect(e.stats.correct).toBe(2);
    const next = trainer(s, { loop: true });
    expect(next.beat).toBe(2);
    expect(next.target[0].midi).toBe(60);
  });
  it("单音、重复音必须松开再按", () => {
    const e = trainer();
    e.startRun(0);
    e.down(60, 80, 10);
    expect(e.stats.correct).toBe(1);
    e.down(60, 80, 20);
    expect(e.stats.correct).toBe(1);
    e.up(60);
    e.down(60, 80, 30);
    expect(e.stats.correct).toBe(2);
  });
  it("踏板不会把松开的音当作仍按住", () => {
    const e = trainer(fixture([60, 64], [0, 0]));
    e.startRun(0);
    e.down(60, 80, 10);
    e.pedal = 127;
    e.up(60);
    e.down(64, 80, 30);
    expect(e.stats.correct).toBe(0);
    e.down(60, 80, 50);
    expect(e.stats.correct).toBe(2);
  });
  it("和弦同时按住即通过", () => {
    const e = trainer(fixture([60, 64, 67], [0, 0, 0]));
    e.startRun(0);
    e.down(60, 70, 1);
    e.down(64, 70, 70);
    e.down(67, 70, 150);
    expect(e.stats.correct).toBe(3);
  });
  it("双手可以慢慢找键，和弦不限制两只手的起音间隔", () => {
    const e = trainer(fixture([60, 64], [0, 0]));
    e.startRun(0);
    e.down(60, 70, 10);
    e.update(10000);
    e.down(64, 70, 10001);
    expect(e.stats.correct).toBe(2);
    expect(e.stats.wrong).toBe(0);
  });
  it("错音不推进并记录问题小节", () => {
    const e = trainer();
    e.startRun(0);
    e.down(61, 80, 10);
    expect(e.stats.wrong).toBe(1);
    expect(e.target[0].midi).toBe(60);
    expect(e.stats.problemMeasures).toEqual([1]);
  });
  it("不会直接跳过下一组音，停在目标位置", () => {
    const e = trainer();
    e.startRun(0);
    e.down(60, 80, 10);
    e.update(10000);
    expect(e.beat).toBe(1);
    expect(e.done).toBe(false);
  });
  it("左手练习排除右手音", () => {
    const e = trainer(fixture(), { hand: "left" });
    expect(e.notes).toHaveLength(0);
  });
});
describe("节奏模式", () => {
  it("倒数一小节", () => {
    const e = trainer(fixture(), { mode: "rhythm" });
    e.startRun(0);
    expect(e.beat).toBe(-4);
    e.update(4000);
    expect(e.beat).toBe(0);
  });
  it("支持提前按键与延后按键，记录偏差", () => {
    const e = trainer(fixture([60, 62], [1, 2]), { mode: "rhythm" });
    e.startRun(0, false);
    e.down(60, 80, 900);
    e.up(60);
    e.down(62, 80, 2100);
    expect(e.stats.correct).toBe(2);
    expect(e.stats.offsets).toEqual([-100, 100]);
  });
  it("慢速容差仍以真实毫秒计算", () => {
    const e = trainer(fixture([60], [1]), { mode: "rhythm", speed: 50 });
    e.startRun(0, false);
    e.down(60, 80, 1851);
    expect(e.stats.correct).toBe(1);
    expect(e.stats.offsets[0]).toBe(-149);
  });
  it("超时漏音，之后弹同音也不补分", () => {
    const e = trainer(fixture([60], [0]), { mode: "rhythm" });
    e.startRun(0, false);
    e.update(151);
    e.down(60, 80, 200);
    expect(e.stats.missed).toBe(1);
    expect(e.stats.correct).toBe(0);
    expect(e.stats.wrong).toBe(1);
  });
  it("暂停时间不进入节拍", () => {
    const e = trainer(fixture([60], [2]), { mode: "rhythm" });
    e.startRun(0, false);
    e.update(1000);
    e.pause();
    e.update(9000);
    e.startRun(10000, false);
    e.update(11000);
    expect(e.beat).toBe(2);
  });
  it("循环区间排除结束边界音并可新建下一轮", () => {
    const song = fixture([60, 62], [3, 4]);
    const e = trainer(song, { mode: "rhythm", loop: true });
    expect(e.notes.map((n) => n.midi)).toEqual([60]);
    e.startRun(0, false);
    e.update(4000);
    expect(e.done).toBe(false);
    e.update(4151);
    expect(e.done).toBe(true);
    expect(e.stats.missed).toBe(1);
    expect(trainer(song, { loop: true }).stats.missed).toBe(0);
  });
  it("速度和变速映射互为逆运算", () => {
    const tempos = [
      { beat: 0, bpm: 60 },
      { beat: 2, bpm: 120 },
    ];
    expect(beatToSeconds(4, tempos)).toBe(3);
    expect(secondsToBeat(3, tempos)).toBe(4);
  });
  it("区间末尾仍允许 150ms 内的延后起音", () => {
    const e = trainer(fixture([60], [3.95]), { mode: "rhythm" });
    e.startRun(0, false);
    e.down(60, 80, 4050);
    expect(e.stats.correct).toBe(1);
    expect(e.done).toBe(false);
    e.update(4151);
    expect(e.done).toBe(true);
  });
});

describe("谱面反馈", () => {
  it("节奏模式区分准时、偏早、偏晚，不改变起音评分", () => {
    const e = trainer(fixture([60, 62, 64], [0, 1, 2]), { mode: "rhythm" });
    e.startRun(0, false);
    e.down(60, 80, 10);
    e.up(60, 450);
    e.down(62, 80, 900);
    e.up(62, 1350);
    e.down(64, 80, 2100);
    e.up(64, 2550);
    expect(e.feedback.get("0")?.status).toBe("correct");
    expect(e.feedback.get("1")).toMatchObject({
      status: "early",
      offsetMs: -100,
      short: false,
    });
    expect(e.feedback.get("2")).toMatchObject({
      status: "late",
      offsetMs: 100,
    });
    expect(e.stats.correct).toBe(3);
  });
  it("错音可纠正，漏音在对应音符记录", () => {
    const e = trainer(fixture([60, 62], [0, 1]));
    e.startRun(0);
    e.down(61, 80, 10);
    expect(e.feedback.get("0")?.status).toBe("wrong");
    e.up(61, 20);
    e.down(60, 80, 30);
    expect(e.feedback.get("0")).toMatchObject({
      status: "correct",
      wrongAttempts: 1,
    });
    const r = trainer(fixture([60], [0]), { mode: "rhythm" });
    r.startRun(0, false);
    r.update(151);
    expect(r.feedback.get("0")?.status).toBe("missed");
  });
  it("节奏模式按键时值按实际速度折算，踏板不掩盖提前松键，不扣起音分", () => {
    const e = trainer(fixture([60], [0]), { mode: "rhythm", speed: 50 });
    e.startRun(0, false);
    e.down(60, 80, 0);
    e.pedal = 127;
    e.up(60, 200);
    expect(e.feedback.get("0")).toMatchObject({
      short: true,
      heldMs: 200,
      expectedMs: 1000,
    });
    expect(e.stats.correct).toBe(1);
    expect(e.accuracy).toBe(100);
  });
  it("自由跟弹只看音高，不提示提前或时值不足", () => {
    const e = trainer(fixture([60, 62], [0, 3]), { speed: 25 });
    e.startRun(0);
    e.down(60, 80, 0);
    e.up(60, 10);
    e.down(62, 80, 20);
    e.up(62, 30);
    expect(e.feedback.get("0")?.short).toBe(false);
    expect(e.feedback.get("1")?.status).toBe("correct");
    expect(e.stats.wrong).toBe(0);
  });
  it("暂停不产生时值不足，重弹相同音高不篡改之前结果", () => {
    const e = trainer(fixture([60, 60], [0, 1]));
    e.startRun(0);
    e.down(60, 80, 0);
    e.up(60, 450);
    e.update(1000);
    e.down(60, 80, 1000);
    e.pause();
    e.up(60, 1100);
    expect(e.feedback.get("0")?.short).toBe(false);
    expect(e.feedback.get("1")?.short).toBe(false);
  });
});

it("起始线可从小节内音符开始，不把之前的音判为漏音", () => {
  const e = trainer(fixture([60, 62, 64], [0, 1, 2]), {
    mode: "rhythm",
    startBeat: 1,
  });
  expect(e.start).toBe(1);
  expect(e.notes.map((n) => n.midi)).toEqual([62, 64]);
  e.startRun(0, false);
  e.down(62, 80, 0);
  expect(e.stats.correct).toBe(1);
  expect(e.stats.missed).toBe(0);
});
