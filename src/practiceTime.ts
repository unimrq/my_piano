import { newId } from "./model";

export interface PracticeContext {
  songId: string;
  title: string;
  mode: "wait" | "free" | "rhythm";
}
export interface PracticeSpan extends PracticeContext {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
}
const IDLE_MS = 30_000;

export class PracticeTime {
  private current:
    (PracticeContext & { id: string; startedAt: number }) | undefined;
  private held = new Set<number>();
  private lastInput = 0;
  private lastNow = 0;

  private clock(now: number) {
    this.lastNow = Math.max(this.lastNow, now);
    return this.lastNow;
  }
  private snapshot(now: number): PracticeSpan {
    const current = this.current!;
    const endedAt = Math.max(
      current.startedAt + 1,
      this.held.size ? Math.min(now, this.lastInput + IDLE_MS) : this.lastInput,
    );
    return { ...current, endedAt, durationMs: endedAt - current.startedAt };
  }
  private finish(now: number) {
    const span = this.snapshot(now);
    this.current = undefined;
    this.held.clear();
    return span;
  }
  private expire(now: number) {
    if (this.current && now - this.lastInput >= IDLE_MS)
      return this.finish(now);
  }
  noteOn(midi: number, context: PracticeContext, now: number) {
    const time = this.clock(now);
    let completed = this.expire(time);
    if (
      this.current &&
      (this.current.songId !== context.songId ||
        this.current.mode !== context.mode)
    )
      completed = this.finish(time);
    this.current ??= { ...context, id: newId(), startedAt: time };
    this.held.add(midi);
    this.lastInput = time;
    return completed;
  }
  noteOff(midi: number, now: number) {
    const time = this.clock(now);
    const completed = this.expire(time);
    if (this.current && this.held.delete(midi)) this.lastInput = time;
    return completed;
  }
  checkpoint(now: number): PracticeSpan | undefined {
    const time = this.clock(now);
    return (
      this.expire(time) ?? (this.current ? this.snapshot(time) : undefined)
    );
  }
  stop(now: number): PracticeSpan | undefined {
    const time = this.clock(now);
    if (this.current) return this.finish(time);
  }
}

export function summarizePracticeTime(spans: PracticeSpan[]) {
  const byDay: Record<string, number> = {};
  let totalMs = 0;
  for (const span of spans) {
    let cursor = span.startedAt;
    const end = span.endedAt;
    if (!Number.isFinite(cursor) || !Number.isFinite(end) || end <= cursor)
      continue;
    totalMs += end - cursor;
    while (cursor < end) {
      const date = new Date(cursor);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const midnight = new Date(
        date.getFullYear(),
        date.getMonth(),
        date.getDate() + 1,
      ).getTime();
      const next = Math.min(midnight, end);
      byDay[key] = (byDay[key] ?? 0) + next - cursor;
      cursor = next;
    }
  }
  return { totalMs, byDay };
}
