import type { Song } from "./model";
import { makeXml } from "./notation";
// Original elementary arrangements of public-domain melodies (not copied editions).
const melodies: [string, string, string, number[], number[]][] = [
  [
    "小星星",
    "法国民歌 Ah! vous dirai-je, maman（18 世纪）",
    "入门",
    [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60],
    [1, 1, 1, 1, 1, 1, 2, 1, 1, 1, 1, 1, 1, 2],
  ],
  [
    "欢乐颂",
    "贝多芬《第九交响曲》主题（1824）",
    "入门",
    [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5, 0.5, 2],
  ],
  [
    "两只老虎",
    "法国民歌 Frère Jacques（传统旋律）",
    "入门",
    [
      60, 62, 64, 60, 60, 62, 64, 60, 64, 65, 67, 64, 65, 67, 67, 69, 67, 65,
      64, 60, 67, 69, 67, 65, 64, 60, 60, 55, 60, 60, 55, 60,
    ],
    [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 1, 1, 2, 0.5, 0.5, 0.5, 0.5, 1, 1, 0.5,
      0.5, 0.5, 0.5, 1, 1, 1, 1, 2, 1, 1, 2,
    ],
  ],
  [
    "划小船",
    "传统歌曲 Row, Row, Row Your Boat（19 世纪）",
    "初级",
    [
      60, 60, 60, 62, 64, 64, 62, 64, 65, 67, 72, 72, 72, 67, 67, 67, 64, 64,
      64, 60, 60, 60, 67, 65, 64, 62, 60,
    ],
    [
      1, 1, 0.75, 0.25, 1, 0.75, 0.25, 0.75, 0.25, 2, 0.5, 0.5, 0.5, 0.5, 0.5,
      0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.75, 0.25, 0.75, 0.25, 2,
    ],
  ],
  [
    "伦敦桥",
    "英国传统民歌 London Bridge Is Falling Down",
    "入门",
    [
      67, 69, 67, 65, 64, 65, 67, 62, 64, 65, 64, 65, 67, 67, 69, 67, 65, 64,
      65, 67, 62, 67, 64, 60,
    ],
    [
      0.75, 0.25, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1, 0.75, 0.25,
      0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1, 1,
    ],
  ],
];
export function demos(): Song[] {
  return melodies.map(
    ([title, source, difficulty, pitches, lengths], index) => {
      let beat = 0;
      const notes: Song["notes"] = pitches.map((midi, i) => {
        const n = {
          id: `d${i}`,
          midi,
          beat,
          duration: lengths[i] * 0.9,
          velocity: 75,
          track: 0,
          measure: Math.floor(beat / 4),
          hand: "right" as const,
        };
        beat += lengths[i];
        return n;
      });
      const duration = Math.ceil(beat / 4) * 4;
      for (let b = 0; b < duration; b += 4)
        notes.push({
          id: `l${b}`,
          midi: b % 8 === 0 ? 48 : 43,
          beat: b,
          duration: 3.5,
          velocity: 55,
          track: 1,
          measure: b / 4,
          hand: "left",
        } as Song["notes"][number]);
      notes.sort((a, b) => a.beat - b.beat);
      const song: Song = {
        id: `demo-${index + 1}`,
        title,
        source: "builtin",
        notes,
        tracks: [
          {
            id: 0,
            name: "旋律 · 右手",
            count: pitches.length,
            low: 55,
            high: 72,
            role: "right",
          },
          {
            id: 1,
            name: "简易低音 · 左手",
            count: duration / 4,
            low: 43,
            high: 48,
            role: "left",
          },
        ],
        measures: Array.from({ length: duration / 4 }, (_, i) => ({
          index: i,
          beat: i * 4,
          length: 4,
          beats: 4,
          beatType: 4,
          label: String(i + 1),
        })),
        tempos: [{ beat: 0, bpm: 80 }],
        duration,
        xml: "",
        difficulty,
        composer: index === 1 ? "贝多芬" : "传统旋律",
        category: "入门旋律",
        edition: "自制简易编配",
        sourceInfo: `${source}；琴习自制简易练习编配，不代表原作完整版本。`,
      };
      song.xml = makeXml(song);
      return song;
    },
  );
}
