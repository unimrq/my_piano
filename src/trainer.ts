import {
  beatToSeconds,
  practiceNotes,
  secondsToBeat,
  type Note,
  type Settings,
  type Song,
} from "./model";
export interface NoteFeedback {
  status: "correct" | "early" | "late" | "wrong" | "missed";
  offsetMs?: number;
  short?: boolean;
  heldMs?: number;
  expectedMs?: number;
  wrongAttempts?: number;
}
export interface Stats {
  correct: number;
  wrong: number;
  missed: number;
  offsets: number[];
  problemMeasures: number[];
}
export class Trainer {
  beat = 0;
  running = false;
  done = false;
  stats: Stats = {
    correct: 0,
    wrong: 0,
    missed: 0,
    offsets: [],
    problemMeasures: [],
  };
  readonly notes: Note[];
  readonly start: number;
  readonly end: number;
  held = new Map<number, { time: number; serial: number; velocity: number }>();
  pedal = 0;
  lastVelocity = 0;
  wrongKey = -1;
  feedback = new Map<string, NoteFeedback>();
  feedbackRevision = 0;
  private durations = new Map<
    string,
    { midi: number; started: number; expected: number }
  >();
  private serial = 0;
  private usedSerial = 0;
  private hits = new Set<string>();
  private missed = new Set<string>();
  private lastNow = 0;
  private elapsed = 0;
  private groups: Note[][] = [];
  private group = 0;
  constructor(
    public song: Song,
    public settings: Settings,
  ) {
    const first =
        song.measures[Math.max(0, settings.from - 1)] ?? song.measures[0],
      last =
        song.measures[Math.min(song.measures.length - 1, settings.to - 1)] ??
        song.measures.at(-1)!;
    this.end = last.beat + last.length;
    this.start = Math.max(
      first.beat,
      Math.min(this.end - 0.001, settings.startBeat ?? first.beat),
    );
    this.beat = this.start;
    this.notes = practiceNotes(song, settings).filter(
      (n) => n.beat >= this.start - 0.001 && n.beat < this.end - 0.001,
    );
    for (const n of this.notes) {
      const prev = this.groups.at(-1);
      if (prev && Math.abs(prev[0].beat - n.beat) < 0.001) prev.push(n);
      else this.groups.push([n]);
    }
    if (settings.mode === "wait" && this.target.length)
      this.beat = this.target[0].beat;
    this.elapsed = beatToSeconds(this.beat, song.tempos);
  }
  get accuracy() {
    const { correct, wrong, missed } = this.stats;
    const total = correct + wrong + missed;
    return total ? Math.round((correct / total) * 100) : 0;
  }
  get target() {
    return this.groups[this.group] ?? [];
  }
  get waiting() {
    return this.settings.mode === "wait" && this.target.length > 0;
  }
  startRun(now: number, countIn = true) {
    if (this.done) return;
    this.running = true;
    this.lastNow = now;
    if (countIn && this.settings.mode !== "wait") {
      const m =
        this.song.measures[this.settings.from - 1] ?? this.song.measures[0];
      const bpm =
        this.song.tempos.findLast((t) => t.beat <= this.start)?.bpm ?? 100;
      this.elapsed =
        beatToSeconds(this.start, this.song.tempos) - (m.length * 60) / bpm;
      this.beat = this.start - m.length;
    }
  }
  pause() {
    this.running = false;
    this.held.clear();
    this.durations.clear();
  }
  update(now: number) {
    if (!this.running) return;
    const delta = Math.max(0, (now - this.lastNow) / 1000);
    this.lastNow = now;
    // Waiting practice follows each correct onset, with no clock between notes.
    if (this.settings.mode === "wait") return;
    this.elapsed += (delta * this.settings.speed) / 100;
    const next = secondsToBeat(this.elapsed, this.song.tempos);
    this.beat = Math.min(next, this.end);
    if (this.settings.mode === "rhythm") this.expire();
    // Keep the final late-hit window open even if an onset is close to B.
    const tailMs =
      ((this.elapsed - beatToSeconds(this.end, this.song.tempos)) /
        (this.settings.speed / 100)) *
      1000;
    if (
      next >= this.end &&
      (this.settings.mode !== "rhythm" || tailMs >= 150)
    ) {
      if (this.settings.mode === "rhythm")
        for (const n of this.notes)
          if (!this.hits.has(n.id) && !this.missed.has(n.id)) this.markMiss(n);
      this.running = false;
      this.done = true;
    }
  }
  private problem(measure: number) {
    if (!this.stats.problemMeasures.includes(measure + 1))
      this.stats.problemMeasures.push(measure + 1);
  }
  private annotate(
    n: Note,
    patch: Partial<NoteFeedback> & Pick<NoteFeedback, "status">,
  ) {
    this.feedback.set(n.id, { ...this.feedback.get(n.id), ...patch });
    this.feedbackRevision++;
  }
  private hit(n: Note, now: number, offsetMs?: number) {
    this.hits.add(n.id);
    this.annotate(n, {
      status:
        offsetMs === undefined || Math.abs(offsetMs) <= 40
          ? "correct"
          : offsetMs < 0
            ? "early"
            : "late",
      offsetMs,
      short: false,
    });
    const expected =
      ((beatToSeconds(n.beat + n.duration, this.song.tempos) -
        beatToSeconds(n.beat, this.song.tempos)) *
        1000) /
      (this.settings.speed / 100);
    this.durations.set(n.id, {
      midi: n.midi,
      started: this.held.get(n.midi)?.time ?? now,
      expected,
    });
  }
  private wrongAt(n: Note | undefined) {
    if (n && !this.hits.has(n.id) && !this.missed.has(n.id))
      this.annotate(n, {
        status: "wrong",
        wrongAttempts: (this.feedback.get(n.id)?.wrongAttempts ?? 0) + 1,
      });
  }
  private markMiss(n: Note) {
    this.missed.add(n.id);
    this.annotate(n, { status: "missed" });
    this.stats.missed++;
    this.problem(n.measure);
  }
  private expire() {
    for (const n of this.notes) {
      if (this.hits.has(n.id) || this.missed.has(n.id)) continue;
      const delta =
        ((this.elapsed - beatToSeconds(n.beat, this.song.tempos)) /
          (this.settings.speed / 100)) *
        1000;
      if (delta > 150) this.markMiss(n);
    }
  }
  down(midi: number, velocity: number, now: number) {
    if (this.held.has(midi)) return;
    this.lastVelocity = velocity;
    this.held.set(midi, { time: now, serial: ++this.serial, velocity });
    this.wrongKey = -1;
    if (!this.running || this.settings.mode === "listen") return;
    this.update(now);
    if (!this.running) return;
    if (this.settings.mode === "wait") {
      if (!this.target.length) return;
      const target = this.target;
      const expected = target.some((n) => n.midi === midi);
      if (!this.waiting || !expected) {
        this.stats.wrong++;
        this.wrongKey = midi;
        this.problem(target[0]?.measure ?? 0);
        this.wrongAt(target.find((n) => n.midi === midi) ?? target[0]);
        return;
      }
      const presses = [...new Set(target.map((n) => n.midi))].map((key) =>
        this.held.get(key),
      );
      if (presses.every((p) => p && p.serial > this.usedSerial)) {
        for (const n of target) this.hit(n, now);
        this.stats.correct += target.length;
        this.usedSerial = this.serial;
        this.group++;
        this.beat = this.target[0]?.beat ?? this.end;
        this.elapsed = beatToSeconds(this.beat, this.song.tempos);
        if (!this.target.length) {
          this.running = false;
          this.done = true;
        }
      }
    } else {
      const n = this.notes
        .filter(
          (n) =>
            n.midi === midi && !this.hits.has(n.id) && !this.missed.has(n.id),
        )
        .map((n) => ({
          n,
          offset:
            ((this.elapsed - beatToSeconds(n.beat, this.song.tempos)) /
              (this.settings.speed / 100)) *
            1000,
        }))
        .filter((v) => Math.abs(v.offset) <= 150)
        .sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset))[0];
      if (n) {
        this.hit(n.n, now, Math.round(n.offset));
        this.stats.correct++;
        this.stats.offsets.push(Math.round(n.offset));
      } else {
        this.stats.wrong++;
        this.wrongKey = midi;
        const nearest = this.notes
          .filter((n) => !this.hits.has(n.id) && !this.missed.has(n.id))
          .sort(
            (a, b) =>
              Math.abs(a.beat - this.beat) - Math.abs(b.beat - this.beat),
          )[0];
        if (
          nearest &&
          Math.abs(
            beatToSeconds(nearest.beat, this.song.tempos) - this.elapsed,
          ) /
            (this.settings.speed / 100) <=
            0.6
        )
          this.wrongAt(nearest);
        this.problem(
          this.song.measures.findLast((m) => m.beat <= this.beat)?.index ?? 0,
        );
      }
    }
  }
  up(midi: number, now = this.lastNow) {
    for (const [id, press] of this.durations) {
      if (press.midi !== midi) continue;
      const heldMs = Math.max(0, now - press.started);
      const previous = this.feedback.get(id)!;
      this.feedback.set(id, {
        ...previous,
        heldMs: Math.round(heldMs),
        expectedMs: Math.round(press.expected),
        short:
          this.settings.mode === "rhythm" &&
          heldMs < press.expected * 0.8 &&
          press.expected - heldMs > 80,
      });
      this.feedbackRevision++;
      this.durations.delete(id);
    }
    this.held.delete(midi);
    if (this.wrongKey === midi) this.wrongKey = -1;
  }
  isHit(id: string) {
    return this.hits.has(id);
  }
}
