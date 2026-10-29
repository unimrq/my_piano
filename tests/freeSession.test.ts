import { it, expect } from "vitest";
import { FreePlaySession } from "../src/freeSession";
it("自由弹奏记录和弦与力度，不需要曲谱", () => {
  const s = new FreePlaySession();
  for (const m of [48, 60, 64, 67]) s.input([144, m, 90], 1);
  expect(s.active.size).toBe(4);
  expect(s.notes).toHaveLength(4);
  expect(s.notes.every((n) => n.velocity === 90 && n.start === 1)).toBe(true);
});
it("重复音与零力度NoteOn正确分隔", () => {
  const s = new FreePlaySession();
  s.input([144, 60, 90], 1);
  s.input([144, 60, 80], 2);
  expect(s.notes[0].end).toBe(2);
  expect(s.active.size).toBe(1);
  s.input([144, 60, 0], 3);
  expect(s.notes[1].end).toBe(3);
  expect(s.active.size).toBe(0);
});
it("踏板不把松键误判为继续按住，清理与断线释放全部音符", () => {
  const s = new FreePlaySession();
  s.input([144, 60, 90], 1);
  s.input([176, 64, 127], 1);
  s.input([128, 60, 0], 2);
  expect(s.pedal).toBe(127);
  expect(s.active.size).toBe(0);
  s.input([144, 62, 90], 3);
  s.release(4);
  expect(s.notes.at(-1)?.end).toBe(4);
  expect(s.pedal).toBe(0);
  s.clear();
  expect(s.notes).toEqual([]);
});
it("按MIDI通道分别松键，支持AllNotesOff", () => {
  const s = new FreePlaySession();
  s.input([144, 60, 90], 1);
  s.input([145, 60, 80], 1);
  s.input([128, 60, 0], 2);
  expect(s.active.size).toBe(1);
  s.input([177, 123, 0], 3);
  expect(s.active.size).toBe(0);
});
it("画面历史有界，长按不被8秒过期清掉，非法音区忽略", () => {
  const s = new FreePlaySession();
  s.input([144, 60, 90], 0);
  s.input([144, 10, 90], 1);
  for (let i = 0; i < 3000; i++) {
    s.input([144, 64, 90], 1 + i / 1000);
    s.input([128, 64, 0], 1 + i / 1000);
  }
  expect(s.notes.length).toBeLessThanOrEqual(2048);
  s.prune(30);
  expect(s.notes.every((n) => n.end === undefined)).toBe(true);
  expect(s.notes.map((n) => n.midi)).toEqual([60]);
  expect(s.active.size).toBe(1);
});
