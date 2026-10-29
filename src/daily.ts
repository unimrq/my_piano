import { makeXml } from "./notation";
import type { Song, Note } from "./model";
export const challengeDate = (now = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
// Stable v1 generator: date + tier is the complete seed, no network or random state.
export function dailyChallenge(date: string, tier: 0 | 1 | 2): Song {
  let state = 2166136261;
  for (const char of `qinxi-daily-v1:${date}:${tier}`)
    state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const names = ["基础", "进阶", "挑战"],
    notes: Note[] = [],
    scale = [60, 62, 64, 65, 67, 69, 71, 72, 74, 76, 77, 79];
  let degree = 2;
  const add = (
    midi: number,
    beat: number,
    duration: number,
    hand: "left" | "right",
  ) =>
    notes.push({
      id: `daily-${notes.length}`,
      midi,
      beat,
      duration,
      hand,
      track: hand === "right" ? 0 : 1,
      measure: Math.floor(beat / 4),
      velocity: 78,
    });
  for (let bar = 0; bar < 8; bar++) {
    const root = [48, 53, 55, 48][bar % 4];
    if (tier === 0) add(root, bar * 4, 4, "left");
    else if (tier === 1) {
      add(root, bar * 4, 2, "left");
      add(root + 7, bar * 4 + 2, 2, "left");
    } else
      for (let b = 0; b < 4; b++)
        add(root + [0, 7, 12, 7][b], bar * 4 + b, 1, "left");
    for (let offset = 0; offset < 4;) {
      const step =
        tier === 0 ? 1 : tier === 1 ? (random() < 0.35 ? 0.5 : 1) : 0.5;
      degree = Math.max(
        0,
        Math.min(tier === 0 ? 7 : 11, degree + Math.floor(random() * 5) - 2),
      );
      const duration = Math.min(step, 4 - offset);
      add(
        bar === 7 && offset + duration === 4 ? 60 : scale[degree],
        bar * 4 + offset,
        duration,
        "right",
      );
      offset += duration;
    }
  }
  notes.sort((a, b) => a.beat - b.beat || a.midi - b.midi);
  const song: Song = {
    id: `daily-v1-${date}-${tier}`,
    title: `每日视奏 · ${names[tier]} · ${date}`,
    source: "builtin",
    xml: "",
    notes,
    tracks: [
      {
        id: 0,
        name: "右手",
        role: "right",
        count: notes.filter((n) => n.hand === "right").length,
        low: 60,
        high: 79,
      },
      {
        id: 1,
        name: "左手",
        role: "left",
        count: notes.filter((n) => n.hand === "left").length,
        low: 48,
        high: 67,
      },
    ],
    measures: Array.from({ length: 8 }, (_, index) => ({
      index,
      label: String(index + 1),
      beat: index * 4,
      length: 4,
      beats: 4,
      beatType: 4,
    })),
    tempos: [{ beat: 0, bpm: [64, 80, 96][tier] }],
    duration: 32,
    composer: "钢琴练习",
    category: "每日视奏",
    difficulty: ["入门", "初级", "中级"][tier],
    focus: [
      "级进旋律与左手长音",
      "八分音符与分手协调",
      "连续八分音符与左手分解",
    ][tier],
    sourceInfo: "钢琴练习本地确定性生成；按北京时间日期、难度与 v1 算法固定。",
    license: "CC0-1.0",
    edition: "原创视奏练习",
  };
  song.xml = makeXml(song);
  return song;
}
