import { describe, it, expect } from "vitest";
import { ChordControls } from "../src/chordControls";
describe("钢琴和弦操作", () => {
  it("完整按住一秒只触发一次，须全部松开", () => {
    const c = new ChordControls();
    [21, 22, 27].forEach((n) =>
      expect(c.input(n, true, 0, true, 21)).toBe(true),
    );
    expect(c.poll(999)).toBe(null);
    expect(c.poll(1000)).toBe("toggle");
    expect(c.poll(2000)).toBe(null);
    c.input(27, false, 2100, true, 21);
    c.input(27, true, 2200, true, 21);
    expect(c.poll(3300)).toBe(null);
    [21, 22, 27].forEach((n) => c.input(n, false, 3400, true, 21));
    [21, 22, 27].forEach((n) => c.input(n, true, 3500, true, 21));
    expect(c.poll(4500)).toBe("toggle");
  });
  it("松开、额外保留音、禁用均不触发，普通琴键交给练习引擎", () => {
    const c = new ChordControls();
    expect(c.input(60, true, 0, true, 21)).toBe(false);
    [21, 22, 27].forEach((n) => c.input(n, true, 0, true, 21));
    c.input(22, false, 900, true, 21);
    expect(c.poll(1100)).toBe(null);
    c.clear();
    [21, 22, 27, 29].forEach((n) => c.input(n, true, 0, true, 21));
    expect(c.poll(1100)).toBe(null);
    c.clear();
    expect(c.input(21, true, 0, false, 21)).toBe(false);
  });
  it("支持修改音区和重来组合，断线清除候选", () => {
    const c = new ChordControls();
    [35, 36, 41].forEach((n) => c.input(n, true, 0, true, 33));
    expect(c.poll(1000)).toBe("restart");
    c.clear();
    expect(c.poll(3000)).toBe(null);
  });
});
