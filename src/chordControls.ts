// Reserved physical keys never enter the scoring engine. Pedal events are unrelated.
export class ChordControls {
  private held = new Set<number>();
  private since = 0;
  private action: "toggle" | "restart" | null = null;
  private latched = false;
  clear() {
    this.held.clear();
    this.since = 0;
    this.action = null;
    this.latched = false;
  }
  input(
    key: number,
    down: boolean,
    now: number,
    enabled: boolean,
    root: number,
  ) {
    const reserved = [0, 1, 2, 3, 6, 8].map((n) => n + root);
    const consumed = this.held.has(key) || (enabled && reserved.includes(key));
    if (!consumed) return false;
    if (down) this.held.add(key);
    else this.held.delete(key);
    if (!this.held.size) this.latched = false;
    const matches = (offsets: number[]) =>
      this.held.size === 3 && offsets.every((n) => this.held.has(root + n));
    const next = enabled
      ? matches([0, 1, 6])
        ? "toggle"
        : matches([2, 3, 8])
          ? "restart"
          : null
      : null;
    if (next !== this.action) {
      this.action = next;
      this.since = now;
    }
    return true;
  }
  poll(now: number) {
    if (!this.action || this.latched || now - this.since < 1000) return null;
    this.latched = true;
    return this.action;
  }
}
