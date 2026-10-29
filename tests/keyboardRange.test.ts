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
  expect(view.update([21], 21, "follow", 8.99)).toBe(moved);
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

it("滚动五秒窗口的高音逐步退出时，前两小节不逐键缩放", () => {
  // The opening phrase's look-ahead bounds: successive high notes leave the
  // window before the bass changes. These are bounds, not a bundled score.
  const bounds = [
    [52, 93],
    [52, 93],
    [52, 91],
    [52, 88],
    [50, 88],
  ];
  const view = new KeyboardRange();
  const first = view.update(bounds[0], 21, "follow", 0);
  let now = 0;
  for (const pitches of bounds) {
    for (let frame = 0; frame <= 40; frame++) {
      expect(view.update(pitches, 21, "follow", now + frame / 10)).toBe(first);
    }
    now += 4;
  }
  expect(width(first)).toBe(35);
});

it("收缩依据稳定时间内的全部音域，不在交替单音和和弦之间来回缩放", () => {
  const view = new KeyboardRange();
  view.update([36, 96], 21, "follow", 0);
  for (let frame = 0; frame <= 80; frame++) {
    const pitches = frame % 2 ? [48] : [79, 81, 84];
    view.update(pitches, 21, "follow", 1 + frame / 10);
  }
  const settled = view.range;
  expect(width(settled)).toBe(28);
  expect(pianoWhites[settled[0]]).toBeLessThanOrEqual(48);
  expect(pianoWhites[settled[1] - 1]).toBeGreaterThanOrEqual(84);
  for (let frame = 0; frame <= 80; frame++) {
    expect(
      view.update(
        frame % 2 ? [48] : [79, 81, 84],
        21,
        "follow",
        10 + frame / 10,
      ),
    ).toBe(settled);
  }
});

it("窄音区越界只平移，仍需等待三秒后才缩窄", () => {
  const view = new KeyboardRange();
  const wide = view.update([21, 84], 21, "follow", 0);
  const moved = view.update([108], 21, "follow", 1);
  expect(width(moved)).toBe(width(wide));
  expect(moved[1]).toBe(52);
  view.update([108], 21, "follow", 1.1);
  expect(view.update([108], 21, "follow", 4)).toBe(moved);
  expect(width(view.update([108], 21, "follow", 4.2))).toBe(21);
});

it("稳定偏向一侧的音区会居中，短暂音符不会立即移动", () => {
  const view = new KeyboardRange();
  const initial = view.update(
    [pianoWhites[26], pianoWhites[31]],
    21,
    "follow",
    0,
  );
  const pitches = [pianoWhites[34], pianoWhites[36]];
  expect(view.update(pitches, 21, "follow", 1)).toBe(initial);
  expect(view.update(pitches, 21, "follow", 1.5)).toBe(initial);
  const centered = view.update(pitches, 21, "follow", 3);
  expect(width(centered)).toBe(21);
  expect(34 - centered[0]).toBeGreaterThanOrEqual(3);
  expect(centered[1] - 1 - 36).toBeGreaterThanOrEqual(3);
  expect(
    Math.abs((centered[0] + centered[1] - 1) / 2 - 35),
  ).toBeLessThanOrEqual(0.5);
});

it("误触远音后恢复同一乐句的原宽度，不将收缩余量永久计入宽度", () => {
  for (const high of [31, 38]) {
    const view = new KeyboardRange();
    const phrase = [pianoWhites[18], pianoWhites[high]];
    const initial = view.update(phrase, 21, "follow", 0);
    expect(
      width(view.update([...phrase, 24, 103], 21, "follow", 1)),
    ).toBeGreaterThan(40);
    view.update(phrase, 21, "follow", 1.1);
    const restored = view.update(phrase, 21, "follow", 4.2);
    expect(width(restored)).toBe(width(initial));
    expect(view.update(phrase, 21, "follow", 8)).toBe(restored);
  }
});
