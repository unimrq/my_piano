export interface PlayedNote {
  id: number;
  midi: number;
  velocity: number;
  channel: number;
  start: number;
  end?: number;
}
export class FreePlaySession {
  notes: PlayedNote[] = [];
  active = new Map<number, PlayedNote>();
  pedal = 0;
  private serial = 0;
  input(data: Uint8Array | number[], time: number) {
    const [status, midi, velocity] = data;
    const code = status & 0xf0,
      channel = status & 0xf;
    if (code === 0xb0) {
      if (midi === 64) this.pedal = velocity;
      if (midi === 120 || midi === 123)
        for (const [key, note] of this.active)
          if (note.channel === channel) {
            note.end = time;
            this.active.delete(key);
          }
      return;
    }
    if ((code !== 0x90 && code !== 0x80) || midi < 21 || midi > 108) return;
    const key = channel * 128 + midi;
    const previous = this.active.get(key);
    if (previous) {
      previous.end = time;
      this.active.delete(key);
    }
    if (code === 0x90 && velocity > 0) {
      const note = { id: this.serial++, midi, velocity, channel, start: time };
      this.notes.push(note);
      this.active.set(key, note);
    }
    this.prune(time);
  }
  prune(time: number) {
    this.notes = this.notes.filter(
      (n) => n.end === undefined || n.end > time - 8,
    );
    // A MIDI flood must not grow the visual history without bound.
    if (this.notes.length > 2048) {
      let excess = this.notes.length - 2048;
      this.notes = this.notes.filter(
        (note) => note.end === undefined || excess-- <= 0,
      );
    }
  }
  release(time: number) {
    for (const note of this.active.values()) note.end = time;
    this.active.clear();
    this.pedal = 0;
  }
  clear() {
    this.notes = [];
    this.active.clear();
    this.pedal = 0;
  }
}
