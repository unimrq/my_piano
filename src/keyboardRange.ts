export const pianoWhites = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (midi) => ![1, 3, 6, 8, 10].includes(midi % 12),
);

const whiteBounds = (low: number, high: number): [number, number] => {
  const last = pianoWhites.findIndex((m) => m >= high);
  return [
    Math.max(
      0,
      pianoWhites.findLastIndex((m) => m <= low),
    ),
    last < 0 ? 51 : last,
  ];
};

export class KeyboardRange {
  private layout = "";
  private main: [number, number] | undefined;
  private movedAt = -Infinity;
  private pending:
    { low: number; high: number; since: number; idle: boolean } | undefined;
  private manualUntil = -Infinity;

  constructor(public range: [number, number] = [21, 42]) {}

  reset(scorePitches: number[] = []) {
    this.layout = "";
    this.pending = undefined;
    this.manualUntil = -Infinity;
    this.main = undefined;
    if (!scorePitches.length) return;
    const sorted = [...scorePitches].sort((a, b) => a - b);
    const needed = Math.ceil(sorted.length * 0.97);
    let first = 0;
    for (let i = 1; i <= sorted.length - needed; i++) {
      if (
        sorted[i + needed - 1] - sorted[i] <
        sorted[first + needed - 1] - sorted[first]
      )
        first = i;
    }
    this.main = whiteBounds(sorted[first], sorted[first + needed - 1]);
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
    const center = (low: number, high: number, count: number) =>
      Math.max(
        0,
        Math.min(52 - count, Math.floor((low + high + 1 - count) / 2)),
      );
    if (layout !== this.layout) {
      this.layout = layout;
      const span = this.main ? this.main[1] - this.main[0] + 1 : 0;
      const count =
        mode === "full"
          ? 52
          : mode === "follow" && span > minimum
            ? Math.min(52, span + 2)
            : minimum;
      const bounds =
        mode === "follow" && this.main
          ? this.main
          : [this.range[0], this.range[1] - 1];
      const left = mode === "full" ? 0 : center(bounds[0], bounds[1], count);
      this.range = [left, left + count];
      this.movedAt = now;
      this.pending = undefined;
      this.manualUntil = -Infinity;
    }
    if (mode !== "follow" || now < this.manualUntil) return this.range;
    const [left, right] = this.range;
    const count = Math.round(right - left);
    const home = this.main
      ? center(this.main[0], this.main[1], count)
      : undefined;
    const position = (low: number, high: number) => {
      if (home === undefined) return center(low, high, count);
      // Keep the planned phrase visible. An outlier needs a small pan, not
      // a jump that centers one note and hides most of the main range.
      const padding = high - low + 3 <= count ? 1 : 0;
      return Math.max(
        0,
        Math.min(
          52 - count,
          Math.max(high - count + 1 + padding, Math.min(low - padding, home)),
        ),
      );
    };
    const move = (begin: number) => {
      if (begin !== left) {
        this.range = [begin, begin + count];
        this.movedAt = now;
      }
      this.pending = undefined;
      return this.range;
    };
    const notes = [...new Set(pitches)].map((m) => whiteBounds(m, m));
    const bounds = notes.length
      ? [
          Math.min(...notes.map((n) => n[0])),
          Math.max(...notes.map((n) => n[1])),
        ]
      : this.main;
    if (!bounds) {
      this.pending = undefined;
      return this.range;
    }
    const idle = !notes.length;
    const [low, high] = bounds;
    if (high - low + 1 > count) {
      // A distant note must not hide a larger chord or change the song's zoom.
      const current = notes.filter(
        ([lo, hi]) => lo >= left && hi < right,
      ).length;
      let best = left,
        most = current,
        centered = Infinity;
      for (let begin = 0; begin <= 52 - count; begin++) {
        const covered = notes.filter(
          ([lo, hi]) => lo >= begin && hi < begin + count,
        );
        if (!covered.length) continue;
        const error = Math.abs(
          center(
            Math.min(...covered.map((n) => n[0])),
            Math.max(...covered.map((n) => n[1])),
            count,
          ) - begin,
        );
        if (
          covered.length > most ||
          (covered.length === most &&
            (error < centered ||
              (error === centered &&
                Math.abs(begin - left) < Math.abs(best - left))))
        ) {
          best = begin;
          most = covered.length;
          centered = error;
        }
      }
      this.pending = undefined;
      return most > current ? move(best) : this.range;
    }
    const goal = position(low, high);
    if (!idle && (low < left || high >= right)) return move(goal);
    const returning = home !== undefined && goal === home;
    if (
      Math.abs(goal - left) <
      (returning ? 1 : Math.max(3, Math.floor(count * 0.14)))
    ) {
      this.pending = undefined;
      return this.range;
    }
    const settling = idle || returning;
    if (!this.pending || this.pending.idle !== settling)
      this.pending = { low, high, since: now, idle: settling };
    const pending = this.pending;
    pending.low = Math.min(pending.low, low);
    pending.high = Math.max(pending.high, high);
    if (pending.high - pending.low + 1 > count) {
      this.pending = undefined;
      return this.range;
    }
    if (
      now - pending.since >= (settling ? 2.5 : 1) &&
      now - this.movedAt >= 2.5
    )
      return move(position(pending.low, pending.high));
    return this.range;
  }
}
