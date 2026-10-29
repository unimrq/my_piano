// Adapted from PianoPlayer hand geometry and motion-cost rules (MIT).
// Copyright (c) 2017 Marco Musy. See public/licenses/PianoPlayer-MIT.txt.
// Browser adaptation: bounded beam search over complete chords, with held-key constraints.
export type FingerNote = {
  id: string;
  midi: number;
  time: number;
  end: number;
  hand: "left" | "right";
  finger?: number;
};
export type HandSize = "S" | "M" | "L";
export type FingerResult = { fingers: Record<string, number>; skipped: number };
const rest = [-7, -2.8, 0, 2.8, 5.6];
const weights = [1.1, 1, 1.1, 0.9, 0.8];
const blackBias = [0.3, 1, 1.1, 0.8, 0.7];
const keyX = (m: number) =>
  (Math.floor(m / 12) * 7 +
    [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6][m % 12]) *
  2.3;
const black = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);
type Path = { previous?: Path; values: [string, number][] };
type State = {
  cost: number;
  x: number[];
  ends: number[];
  pitches: number[];
  time: number;
  last?: { x: number; finger: number; black: boolean; end: number };
  path?: Path;
};
export function planFingering(
  notes: FingerNote[],
  size: HandSize = "M",
): FingerResult {
  if (notes.length > 20000)
    throw Error("曲谱超过两万音，请先导出需要练习的片段");
  const fingers: Record<string, number> = {};
  let skipped = 0;
  const factor = { S: 0.64, M: 0.82, L: 1 }[size];
  for (const hand of ["right", "left"] as const) {
    const own = notes
      .filter((n) => n.hand === hand)
      .sort((a, b) => a.time - b.time || a.midi - b.midi);
    const groups: FingerNote[][] = [];
    for (const n of own) {
      if (!groups.length || Math.abs(groups.at(-1)![0].time - n.time) > 0.001)
        groups.push([]);
      groups.at(-1)!.push(n);
    }
    let beam: State[] = [
      {
        cost: 0,
        x: [],
        ends: Array(5).fill(-Infinity),
        pitches: Array(5).fill(-1),
        time: 0,
      },
    ];
    for (const group of groups) {
      const unique = [...new Set(group.map((n) => n.midi))].map((midi) =>
        group.filter((n) => n.midi === midi),
      );
      unique.sort((a, b) =>
        hand === "right" ? a[0].midi - b[0].midi : b[0].midi - a[0].midi,
      );
      const next: State[] = [];
      if (unique.length <= 5)
        for (const state of beam) {
          const choices: number[] = [];
          const visit = (index: number, cost: number) => {
            if (index === unique.length) {
              const x = [...state.x],
                ends = [...state.ends],
                pitches = [...state.pitches];
              const values: [string, number][] = [];
              let center = 0;
              for (let i = 0; i < unique.length; i++)
                center +=
                  (hand === "left" ? -1 : 1) * keyX(unique[i][0].midi) -
                  rest[choices[i]] * factor;
              center /= unique.length;
              for (let f = 0; f < 5; f++)
                if (ends[f] <= group[0].time + 0.001)
                  x[f] = center + rest[f] * factor;
              for (let i = 0; i < unique.length; i++) {
                const f = choices[i],
                  peers = unique[i],
                  n = peers[0];
                x[f] = (hand === "left" ? -1 : 1) * keyX(n.midi);
                ends[f] = Math.max(...peers.map((n) => n.end));
                pitches[f] = n.midi;
                for (const peer of peers) values.push([peer.id, f + 1]);
              }
              const n = unique.at(-1)![0],
                f = choices.at(-1)!;
              next.push({
                cost: state.cost + cost,
                x,
                ends,
                pitches,
                time: group[0].time,
                last:
                  unique.length === 1
                    ? { x: x[f], finger: f, black: black(n.midi), end: n.end }
                    : undefined,
                path: { previous: state.path, values },
              });
              return;
            }
            const peers = unique[index],
              n = peers[0];
            const anchors = [
              ...new Set(
                peers.map((n) => n.finger).filter((f): f is number => !!f),
              ),
            ];
            if (anchors.length > 1) return;
            const nx = (hand === "left" ? -1 : 1) * keyX(n.midi);
            for (let f = 0; f < 5; f++) {
              if (anchors.length && anchors[0] !== f + 1) continue;
              if (index && f <= choices[index - 1]) continue;
              if (state.ends[f] > n.time + 0.001 && state.pitches[f] !== n.midi)
                continue;
              // Held notes must keep their relative finger order and remain within reach.
              if (
                state.pitches.some(
                  (p, pf) =>
                    state.ends[pf] > n.time + 0.001 &&
                    p !== n.midi &&
                    ((pf - f) * (state.x[pf] - nx) <= 0 ||
                      Math.abs(state.x[pf] - nx) > 21 * factor),
                )
              )
                continue;
              if (
                index &&
                nx - (hand === "left" ? -1 : 1) * keyX(unique[0][0].midi) >
                  21 * factor
              )
                continue;
              let motion = state.x.length
                ? Math.abs(nx - state.x[f]) /
                  (Math.max(0, n.time - state.time) + 0.1) /
                  weights[f] /
                  (black(n.midi) ? blackBias[f] : 1)
                : black(n.midi)
                  ? (1 / blackBias[f] - 1) * 0.2
                  : 0;
              if (index) {
                const dx =
                  nx -
                  (hand === "left" ? -1 : 1) * keyX(unique[index - 1][0].midi);
                motion += Math.abs(
                  dx - (rest[f] - rest[choices[index - 1]]) * factor,
                );
              }
              const last = state.last;
              if (last && unique.length === 1 && n.time - state.time < 2) {
                const dx = nx - last.x;
                if (f === last.finger && dx) motion += 25;
                if (f > 0 && last.finger > 0 && (f - last.finger) * dx < 0)
                  motion += 100;
                if (f === 0 && black(n.midi) && dx > 0 && last.finger > 0)
                  motion += 40;
              }
              choices[index] = f;
              visit(index + 1, cost + motion);
            }
          };
          visit(0, 0);
        }
      if (!next.length) {
        skipped += group.length;
        continue;
      }
      next.sort((a, b) => a.cost - b.cost);
      // Merge equivalent hand states before pruning so earlier phrase choices can compete.
      const seen = new Set<string>();
      beam = next
        .filter((s) => {
          const key =
            s.pitches
              .map((p, i) =>
                s.ends[i] > group[0].time + 0.001 ? `${p}:${s.ends[i]}` : "-",
              )
              .join(",") +
            "|" +
            s.x.map((x) => x.toFixed(2)).join(",");
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, 48);
    }
    for (let path = beam[0].path; path; path = path.previous)
      for (const [id, f] of path.values) fingers[id] = f;
  }
  return { fingers, skipped };
}
