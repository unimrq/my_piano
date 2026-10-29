export const pianoWhites = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (midi) => ![1, 3, 6, 8, 10].includes(midi % 12),
);

export class KeyboardRange {
  private layout = "";
  private movedAt = -Infinity;
  private narrowSince: number | undefined;

  constructor(public range: [number, number] = [21, 42]) {}

  reset() {
    this.layout = "";
    this.narrowSince = undefined;
  }

  update(
    pitches: number[],
    minimum: number,
    mode: "follow" | "lock" | "full",
    now: number,
  ): [number, number] {
    minimum = Math.max(7, Math.min(52, Math.round(minimum)));
    const layout = `${mode}:${minimum}`;
    const changed = layout !== this.layout;
    this.layout = layout;
    const [left, right] = this.range;
    const center = (low: number, high: number, count: number) =>
      Math.max(
        0,
        Math.min(52 - count, Math.floor((low + high + 1 - count) / 2)),
      );
    const move = (begin: number, count: number) => {
      if (begin !== left || begin + count !== right) {
        this.range = [begin, begin + count];
        this.movedAt = now;
      }
      if (count !== right - left || changed) this.narrowSince = undefined;
      return this.range;
    };
    if (mode === "full") return move(0, 52);
    if (mode === "lock")
      return changed
        ? move(center(left, right - 1, minimum), minimum)
        : this.range;
    if (!pitches.length)
      return changed
        ? move(center(left, right - 1, minimum), minimum)
        : this.range;

    const lowest = Math.min(...pitches),
      highest = Math.max(...pitches);
    const low = Math.max(
      0,
      pianoWhites.findLastIndex((m) => m <= lowest),
    );
    const highIndex = pianoWhites.findIndex((m) => m >= highest);
    const high = highIndex < 0 ? 51 : highIndex;
    const count = Math.min(52, Math.max(minimum, high - low + 7));
    if (changed || low < left || high >= right)
      return move(center(low, high, count), count);

    // Use elapsed real time: wait mode and seeking must not freeze zoom recovery.
    if (count < right - left) this.narrowSince ??= now;
    else this.narrowSince = undefined;
    if (this.narrowSince !== undefined && now - this.narrowSince >= 3)
      return move(center(low, high, count), count);
    if ((low < left + 2 || high >= right - 2) && now - this.movedAt >= 2.5)
      return move(center(low, high, right - left), right - left);
    return this.range;
  }
}
