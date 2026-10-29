import { describe, expect, it } from "vitest";
import {
  PracticeTime,
  summarizePracticeTime,
  type PracticeContext,
} from "../src/practiceTime";

const song: PracticeContext = { songId: "test", title: "练习曲", mode: "wait" };

describe("实际练琴时段", () => {
  it("和弦只计算一段时间，松完后不计尾部空闲", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    timer.noteOn(64, song, 1_000);
    timer.noteOff(60, 2_000);
    expect(timer.checkpoint(2_500)?.durationMs).toBe(1_500);
    timer.noteOff(64, 3_000);
    expect(timer.stop(9_000)).toMatchObject({
      startedAt: 1_000,
      endedAt: 3_000,
      durationMs: 2_000,
    });
  });

  it("重复音和三十秒内短休息保留为同一段", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    const first = timer.checkpoint(1_100)!;
    timer.noteOff(60, 1_500);
    expect(timer.noteOn(60, song, 5_000)).toBeUndefined();
    timer.noteOff(60, 6_000);
    expect(timer.stop(7_000)).toMatchObject({
      id: first.id,
      durationMs: 5_000,
    });
  });

  it("没有有效输入满三十秒结束，结束时间停在最后松键", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    timer.noteOff(60, 2_000);
    const first = timer.checkpoint(31_999)!;
    expect(timer.checkpoint(32_000)).toEqual(first);
    expect(timer.checkpoint(33_000)).toBeUndefined();
    timer.noteOn(62, song, 40_000);
    const next = timer.stop(40_500)!;
    expect(next.id).not.toBe(first.id);
    expect(next.durationMs).toBe(500);
  });

  it("新按键到来时返回已空闲的旧段，并开始独立新段", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 0);
    timer.noteOff(60, 1_000);
    const old = timer.noteOn(62, song, 40_000)!;
    expect(old).toMatchObject({
      startedAt: 0,
      endedAt: 1_000,
      durationMs: 1_000,
    });
    expect(timer.stop(41_000)).toMatchObject({
      startedAt: 40_000,
      durationMs: 1_000,
    });
  });

  it("真实长按计到停止，卡键最多计算三十秒", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 0);
    expect(timer.checkpoint(10_000)?.durationMs).toBe(10_000);
    expect(timer.stop(12_000)?.durationMs).toBe(12_000);
    timer.noteOn(62, song, 20_000);
    expect(timer.checkpoint(70_000)).toMatchObject({
      startedAt: 20_000,
      endedAt: 50_000,
      durationMs: 30_000,
    });
    expect(timer.noteOff(62, 71_000)).toBeUndefined();
    expect(timer.stop(72_000)).toBeUndefined();
  });

  it("checkpoint使用稳定id和独立快照，便于覆盖存档", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    const first = timer.checkpoint(2_000)!;
    const second = timer.checkpoint(3_000)!;
    expect(first.id).toBe(second.id);
    expect(first.durationMs).toBe(1_000);
    expect(second.durationMs).toBe(2_000);
    expect(timer.stop(4_000)).toMatchObject({
      id: first.id,
      durationMs: 3_000,
    });
  });

  it("切曲或切模式分开记录，保留各自标题与模式", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    const old = timer.noteOn(62, { ...song, mode: "free" }, 2_000)!;
    expect(old).toMatchObject({ mode: "wait", durationMs: 1_000 });
    const next = timer.noteOn(
      64,
      { songId: "other", title: "另一首", mode: "rhythm" },
      3_000,
    )!;
    expect(next).toMatchObject({ mode: "free", durationMs: 1_000 });
    expect(timer.stop(4_000)).toMatchObject({
      title: "另一首",
      mode: "rhythm",
      durationMs: 1_000,
    });
  });

  it("未按过的松键不延长时间，零毫秒点按只保存一毫秒", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 1_000);
    timer.noteOff(60, 1_000);
    timer.noteOff(90, 20_000);
    expect(timer.stop(25_000)).toMatchObject({
      startedAt: 1_000,
      endedAt: 1_001,
      durationMs: 1,
    });
    expect(timer.stop(26_000)).toBeUndefined();
  });

  it("时钟后退不产生负时长，向前跳变受空闲保护", () => {
    const timer = new PracticeTime();
    timer.noteOn(60, song, 10_000);
    timer.noteOff(60, 9_000);
    expect(timer.stop(8_000)?.durationMs).toBe(1);
    timer.noteOn(62, song, 20_000);
    expect(timer.stop(1_000_000)?.durationMs).toBe(30_000);
  });

  it("跨本地午夜拆分到两天，下一段时长不会丢失", () => {
    const timer = new PracticeTime();
    const start = new Date(2026, 9, 30, 23, 59, 59, 500).getTime();
    timer.noteOn(60, song, start);
    const crossing = timer.stop(start + 1_500)!;
    const later = new Date(2026, 9, 31, 12, 0, 0).getTime();
    timer.noteOn(62, song, later);
    const next = timer.stop(later + 2_000)!;
    expect(summarizePracticeTime([crossing, next])).toEqual({
      totalMs: 3_500,
      byDay: { "2026-10-30": 500, "2026-10-31": 3_000 },
    });
  });
});
