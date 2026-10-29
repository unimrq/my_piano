export const pianoWhites = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (midi) => ![1, 3, 6, 8, 10].includes(midi % 12),
);

export class KeyboardRange {
  private layout = "";
  private movedAt = -Infinity;
  private pending: { low: number; high: number; since: number } | undefined;
  private manualUntil = -Infinity;

  constructor(public range: [number, number] = [21, 42]) {}

  reset() {
    this.layout = "";
    this.pending = undefined;
    this.manualUntil = -Infinity;
  }
  pan(whiteKeys: number, now: number) {
    const count = Math.round(this.range[1] - this.range[0]);
    const left = Math.max(0, Math.min(52 - count, this.range[0] + whiteKeys));
    this.range = [left, left + count];
    this.manualUntil = now + 8;
    this.pending = undefined;
    return this.range;
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
    const currentCount = Math.round(right - left);
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
      this.pending = undefined;
      return this.range;
    };
    if (mode === "full") return move(0, 52);
    if (mode === "lock")
      return changed
        ? move(center(left, right - 1, minimum), minimum)
        : this.range;
    if (!changed && now < this.manualUntil) return this.range;
    if (!pitches.length) {
      this.pending = undefined;
      return changed
        ? move(center(left, right - 1, minimum), minimum)
        : this.range;
    }

    const lowest = Math.min(...pitches),
      highest = Math.max(...pitches);
    const low = Math.max(
      0,
      pianoWhites.findLastIndex((m) => m <= lowest),
    );
    const highIndex = pianoWhites.findIndex((m) => m >= highest);
    const high = highIndex < 0 ? 51 : highIndex;
    // Keep an octave of white keys between zoom levels. Small changes at the
    // look-ahead boundary should not resize the keyboard and both canvases.
    const countFor = (low: number, high: number, padding = 6) =>
      Math.min(
        52,
        minimum +
          Math.max(0, Math.ceil((high - low + 1 + padding - minimum) / 7)) * 7,
      );
    const count = countFor(low, high);
    if (changed) return move(center(low, high, count), count);
    if (count > currentCount || low < left || high >= right) {
      // A distant single note can require panning, but must not bypass the
      // settling time and immediately shrink a previously wider view.
      const nextCount = Math.max(currentCount, count);
      return move(center(low, high, nextCount), nextCount);
    }

    const narrower = countFor(low, high, 9) < currentCount;
    const offCenter =
      Math.abs(center(low, high, currentCount) - left) >=
      Math.max(3, Math.floor(currentCount * 0.14));
    if (!narrower && !offCenter) {
      this.pending = undefined;
      return this.range;
    }
    this.pending ??= { low, high, since: now };
    this.pending.low = Math.min(this.pending.low, low);
    this.pending.high = Math.max(this.pending.high, high);
    const pendingCount = countFor(this.pending.low, this.pending.high);
    // Use the whole observed phrase, rather than the last frame, to avoid
    // zooming in on one note immediately before the next chord returns.
    // Extra padding gates a shrink; it must not become the new width, which
    // would leave an unchanged phrase one zoom level wider after a stray note.
    if (
      narrower &&
      countFor(this.pending.low, this.pending.high, 9) >= currentCount
    ) {
      this.pending = undefined;
      return this.range;
    }
    const wait = narrower ? 3 : 1;
    if (now - this.pending.since >= wait && now - this.movedAt >= 2.5) {
      return move(
        center(
          this.pending.low,
          this.pending.high,
          narrower ? pendingCount : currentCount,
        ),
        narrower ? pendingCount : currentCount,
      );
    }
    return this.range;
  }
}
