import { expect, it } from "vitest";
import { KeyboardRange, pianoWhites } from "../src/keyboardRange";
const width = (range: [number, number]) => range[1] - range[0];
it("手动拖动保持键宽、限制边界，并暂缓自动跟随", () => {
  const view = new KeyboardRange();
  const initial = view.update([60, 64], 21, "follow", 0);
  const moved = view.pan(5.5, 1);
  expect(moved[0]).toBe(initial[0] + 5.5);
  expect(Math.round(width(moved))).toBe(21);
  expect(view.update([21], 21, "follow", 2)).toBe(moved);
  expect(view.update([21], 21, "follow", 10)[0]).toBe(0);
  expect(view.pan(100, 11)).toEqual([31, 52]);
  expect(view.pan(-100, 12)).toEqual([0, 21]);
});

it("大跨度立即纳入全部琴键，稳定窄音区三秒后恢复放大", () => {
  const view = new KeyboardRange();
  const wide = view.update([36, 96], 21, "follow", 0);
  expect(width(wide)).toBeGreaterThan(21);
  expect(pianoWhites[wide[0]]).toBeLessThanOrEqual(36);
  expect(pianoWhites[wide[1] - 1]).toBeGreaterThanOrEqual(96);
  expect(view.update([60, 64, 67], 21, "follow", 1)).toBe(wide);
  expect(view.update([62, 65, 69], 21, "follow", 3.9)).toBe(wide);
  expect(width(view.update([60, 64, 67], 21, "follow", 4))).toBe(21);
});

it("只宽出几个白键也会恢复，不依赖曲谱继续前进", () => {
  const view = new KeyboardRange();
  const wide = view.update([60, 91], 21, "follow", 10);
  expect(width(wide)).toBeGreaterThan(21);
  view.update([60, 64], 21, "follow", 10.1);
  expect(width(view.update([60, 64], 21, "follow", 13.2))).toBe(21);
});

it("短暂窄音区不反复缩放，宽跨度再次出现会重置稳定计时", () => {
  const view = new KeyboardRange();
  const wide = view.update([24, 103], 21, "follow", 0);
  view.update([60, 64], 21, "follow", 1);
  expect(view.update([24, 103], 21, "follow", 3)).toBe(wide);
  view.update([60, 64], 21, "follow", 3.1);
  expect(view.update([60, 64], 21, "follow", 5)).toBe(wide);
  expect(width(view.update([60, 64], 21, "follow", 6.2))).toBe(21);
});

it("最低和最高音附近仍能缩回，黑键两侧白键不会被裁掉", () => {
  for (const narrow of [
    [21, 22],
    [106, 108],
  ]) {
    const view = new KeyboardRange();
    view.update([21, 108], 21, "follow", 0);
    view.update(narrow, 21, "follow", 1);
    view.update(narrow, 21, "follow", 3.5);
    const next = view.update(narrow, 21, "follow", 4);
    expect(width(next)).toBe(21);
    expect(pianoWhites[next[0]]).toBeLessThanOrEqual(narrow[0]);
    expect(pianoWhites[next[1] - 1]).toBeGreaterThanOrEqual(narrow[1]);
  }
});

it("锁定和完整键盘保持固定音区，显示数量修改立即生效", () => {
  const view = new KeyboardRange();
  expect(view.update([60], 21, "full", 0)).toEqual([0, 52]);
  const locked = view.update([60], 28, "lock", 1);
  expect(width(locked)).toBe(28);
  expect(view.update([21, 108], 28, "lock", 10)).toBe(locked);
  expect(width(view.update([], 35, "follow", 11))).toBe(35);
  expect(width(view.update([60], 14, "follow", 12))).toBe(14);
});
