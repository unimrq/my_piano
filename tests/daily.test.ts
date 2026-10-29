// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { challengeDate, dailyChallenge } from "../src/daily";
import { importScore } from "../src/importer";
describe("离线每日视奏", () => {
  it("按北京时间换日，同日同难度版本完全一致，日期与难度变化生成不同练习", () => {
    expect(challengeDate(new Date("2026-10-29T15:59:00Z"))).toBe("2026-10-29");
    expect(challengeDate(new Date("2026-10-29T16:01:00Z"))).toBe("2026-10-30");
    expect(dailyChallenge("2026-10-29", 0)).toEqual(
      dailyChallenge("2026-10-29", 0),
    );
    expect(dailyChallenge("2026-10-29", 0).xml).not.toEqual(
      dailyChallenge("2026-10-30", 0).xml,
    );
    expect(dailyChallenge("2026-10-29", 0).notes).not.toEqual(
      dailyChallenge("2026-10-29", 1).notes,
    );
  });
  it("三档练习均可往返解析，限定音域、有效音长与8个完整小节，难度提升增加密度", () => {
    const songs = ([0, 1, 2] as const).map((t) =>
      dailyChallenge("2026-10-29", t),
    );
    for (const s of songs) {
      const parsed = importScore(
        "daily.musicxml",
        new TextEncoder().encode(s.xml),
      );
      expect(parsed.notes.length).toBe(s.notes.length);
      expect(parsed.measures).toHaveLength(8);
      expect(parsed.duration).toBe(32);
      expect(
        s.notes.every(
          (n) =>
            n.midi >= 45 &&
            n.midi <= 79 &&
            n.duration > 0 &&
            n.beat + n.duration <= 32,
        ),
      ).toBe(true);
    }
    expect(songs[0].notes.length).toBeLessThan(songs[1].notes.length);
    expect(songs[1].notes.length).toBeLessThan(songs[2].notes.length);
  });
});
