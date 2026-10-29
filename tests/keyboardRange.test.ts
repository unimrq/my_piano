import { expect, it } from "vitest";
import { KeyboardRange, pianoWhites } from "../src/keyboardRange";

const width = (range: [number, number]) => range[1] - range[0];
const visible = (range: [number, number], midi: number) => {
  const low = pianoWhites.findLastIndex((m) => m <= midi);
  const high = pianoWhites.findIndex((m) => m >= midi);
  return low >= range[0] && high < range[1];
};

it("无曲谱的自由练习固定设置数量，远音和时间不会改变键宽", () => {
  const view = new KeyboardRange();
  for (const [time, pitches] of [
    [0, []],
    [1, [21]],
    [2, [108]],
    [10, [21, 108]],
    [100, [60, 64]],
  ] as const) {
    expect(width(view.update([...pitches], 21, "follow", time))).toBe(21);
  }
});

it("全曲主要音区能放下设置数量时严格使用设置数量，不额外留边", () => {
  const view = new KeyboardRange();
  const score = [pianoWhites[16], pianoWhites[36]];
  view.reset(score);
  const range = view.update([], 21, "follow", 0);
  expect(width(range)).toBe(21);
  for (const midi of score) expect(visible(range, midi)).toBe(true);
});

it("双手主要音区开曲时一次规划足够的宽度，整曲不动态缩放", () => {
  const view = new KeyboardRange();
  const score = [
    ...Array(50).fill(pianoWhites[8]),
    ...Array(50).fill(pianoWhites[41]),
  ];
  view.reset(score);
  const initial = view.update([], 21, "follow", 0);
  expect(width(initial)).toBe(36);
  expect(visible(initial, score[0])).toBe(true);
  expect(visible(initial, score[99])).toBe(true);
  for (let time = 1; time <= 100; time++) {
    const pitches = time % 2 ? [60, 64, 67] : [21, 108];
    expect(width(view.update(pitches, 21, "follow", time))).toBe(
      width(initial),
    );
  }
});

it("97%频数窗口保留双手两个主音区，极少数远音不参与宽度规划", () => {
  const view = new KeyboardRange();
  const score = [...Array(48).fill(48), ...Array(49).fill(72), 21, 106, 108];
  const original = [...score];
  view.reset(score);
  const range = view.update([], 7, "follow", 0);
  expect(width(range)).toBe(17);
  expect(visible(range, 48)).toBe(true);
  expect(visible(range, 72)).toBe(true);
  expect(visible(range, 21)).toBe(false);
  expect(visible(range, 108)).toBe(false);
  expect(score).toEqual(original);
});

it("按音符频数统计97%而不是按不同音高统计", () => {
  const view = new KeyboardRange();
  view.reset([...Array(96).fill(60), 48, 48, 84, 84]);
  const range = view.update([], 7, "follow", 0);
  expect(width(range)).toBe(10);
  expect(visible(range, 48)).toBe(true);
  expect(visible(range, 60)).toBe(true);
  expect(visible(range, 84)).toBe(false);
});

it("换曲重新规划，空谱与少量音符不错误排除任何起音", () => {
  const view = new KeyboardRange();
  view.reset([21, 108]);
  expect(view.update([], 7, "follow", 0)).toEqual([0, 52]);
  view.reset([60]);
  const narrow = view.update([], 7, "follow", 1);
  expect(width(narrow)).toBe(7);
  expect(visible(narrow, 60)).toBe(true);
  view.reset();
  expect(width(view.update([], 21, "follow", 2))).toBe(21);
});

it("黑键两侧白键均包含在一次规划的范围内", () => {
  const view = new KeyboardRange();
  view.reset([61, 73]);
  const range = view.update([], 7, "follow", 0);
  expect(width(range)).toBe(11);
  expect(visible(range, 61)).toBe(true);
  expect(visible(range, 73)).toBe(true);
});

it("手动拖动保持键宽、限制边界，并保护八秒", () => {
  const view = new KeyboardRange();
  view.reset([60, 64]);
  const initial = view.update([], 21, "follow", 0);
  const moved = view.pan(5.5, 1);
  expect(moved[0]).toBe(initial[0] + 5.5);
  expect(width(moved)).toBe(21);
  expect(view.update([21], 21, "follow", 2)).toBe(moved);
  expect(view.update([21], 21, "follow", 8.99)).toBe(moved);
  expect(view.update([21], 21, "follow", 10)[0]).toBe(0);
  expect(view.pan(100, 11)).toEqual([31, 52]);
  expect(view.pan(-100, 12)).toEqual([0, 21]);
});

it("锁定按设置数量，完整键盘固定52键，设置变化立即重新规划", () => {
  const view = new KeyboardRange();
  view.reset([pianoWhites[8], pianoWhites[41]]);
  expect(width(view.update([], 21, "follow", 0))).toBe(36);
  expect(view.update([60], 21, "full", 1)).toEqual([0, 52]);
  const locked = view.update([60], 28, "lock", 2);
  expect(width(locked)).toBe(28);
  expect(view.update([21, 108], 28, "lock", 10)).toBe(locked);
  expect(width(view.update([], 35, "follow", 11))).toBe(35);
  expect(width(view.update([], 14, "follow", 12))).toBe(36);
  expect(width(view.update([], 49, "follow", 13))).toBe(49);
});

it("真正越界的单音及时平移，结束后稳定返回主要音区且不缩放", () => {
  const view = new KeyboardRange();
  view.reset(Array(100).fill(60));
  const initial = view.update([], 21, "follow", 0);
  const distant = view.update([108], 21, "follow", 1);
  expect(width(distant)).toBe(21);
  expect(visible(distant, 108)).toBe(true);
  view.update([], 21, "follow", 1.1);
  expect(view.update([], 21, "follow", 3.5)).toBe(distant);
  expect(view.update([], 21, "follow", 3.7)).toEqual(initial);
});

it("稳定偏心音区稍后居中，短暂单音不会立即追踪", () => {
  const view = new KeyboardRange([18, 39]);
  const initial = view.update([], 21, "follow", 0);
  const pitches = [pianoWhites[34], pianoWhites[36]];
  expect(view.update(pitches, 21, "follow", 1)).toBe(initial);
  expect(view.update(pitches, 21, "follow", 1.5)).toBe(initial);
  const centered = view.update(pitches, 21, "follow", 3);
  expect(width(centered)).toBe(21);
  expect(
    Math.abs((centered[0] + centered[1] - 1) / 2 - 35),
  ).toBeLessThanOrEqual(0.5);
});

it("主要音区内交替弹奏不追踪每个音，离群单音只作必要平移", () => {
  const view = new KeyboardRange();
  view.reset([pianoWhites[15], pianoWhites[33]]);
  const initial = view.update([], 21, "follow", 0);
  for (let time = 1; time < 20; time++)
    expect(
      view.update([pianoWhites[time % 2 ? 16 : 32]], 21, "follow", time),
    ).toBe(initial);
  const moved = view.update([pianoWhites[initial[1]]], 21, "follow", 21);
  expect(width(moved)).toBe(21);
  expect(moved[0] - initial[0]).toBe(2);
});

it("一个极远音不会藏掉多数和弦，已有最大覆盖时保留当前位置", () => {
  const view = new KeyboardRange();
  view.reset(Array(100).fill(64));
  const initial = view.update([], 21, "follow", 0);
  expect(view.update([60, 64, 67, 108], 21, "follow", 1)).toBe(initial);
  expect(
    view.update([60, 64, 67, ...Array(10).fill(108)], 21, "follow", 2),
  ).toBe(initial);
  view.pan(100, 3);
  const moved = view.update([60, 64, 67, 108], 21, "follow", 12);
  expect(width(moved)).toBe(21);
  for (const midi of [60, 64, 67]) expect(visible(moved, midi)).toBe(true);
  expect(visible(moved, 108)).toBe(false);
});

it("超宽和弦两端覆盖相同时保留当前音区，不在两端跳转", () => {
  const view = new KeyboardRange();
  view.reset([60]);
  const initial = view.update([], 7, "follow", 0);
  for (let time = 1; time <= 20; time++)
    expect(view.update([60, 108], 7, "follow", time)).toBe(initial);
});
