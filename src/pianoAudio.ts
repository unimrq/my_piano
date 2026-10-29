// Local Salamander samples, Alexander Holm / CC BY 3.0. See public/audio/piano/.
export class PianoAudio {
  private context: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private voices = new Map<
    number,
    { source: AudioBufferSourceNode; gain: GainNode }
  >();
  private root(midi: number) {
    return Math.max(21, Math.min(108, 21 + Math.round((midi - 21) / 3) * 3));
  }
  async prepare(context: AudioContext, pitches: number[]) {
    this.context = context;
    await Promise.all(
      [...new Set(pitches.map((midi) => this.root(midi)))].map(async (midi) => {
        if (this.buffers.has(midi)) return;
        const name =
          ["C", "Cs", "D", "Ds", "E", "F", "Fs", "G", "Gs", "A", "As", "B"][
            midi % 12
          ] +
          (Math.floor(midi / 12) - 1);
        const response = await fetch(`./audio/piano/${name}.mp3`);
        if (!response.ok) throw Error(`钢琴音色加载失败：${name}`);
        this.buffers.set(
          midi,
          await context.decodeAudioData(await response.arrayBuffer()),
        );
      }),
    );
  }
  on(midi: number, velocity: number) {
    const buffer = this.buffers.get(this.root(midi));
    if (!this.context || !buffer) return;
    this.off(midi);
    const source = this.context.createBufferSource(),
      gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = 2 ** ((midi - this.root(midi)) / 12);
    const now = this.context.currentTime;
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(
      (velocity / 127) ** 1.5 * 0.35,
      now + 0.005,
    );
    source.connect(gain).connect(this.context.destination);
    const voice = { source, gain };
    this.voices.set(midi, voice);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      if (this.voices.get(midi) === voice) this.voices.delete(midi);
    };
    source.start();
  }
  off(midi: number) {
    const voice = this.voices.get(midi);
    if (!voice || !this.context) return;
    this.voices.delete(midi);
    const now = this.context.currentTime;
    voice.gain.gain.cancelScheduledValues(now);
    voice.gain.gain.setTargetAtTime(0, now, 0.025);
    voice.source.stop(now + 0.15);
  }
  stop() {
    for (const midi of [...this.voices.keys()]) this.off(midi);
  }
}
