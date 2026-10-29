export interface MidiPort {
  id: string;
  name: string;
  type: string;
  state: string;
  send?: (bytes: number[]) => void;
  onmidimessage?: ((event: { data: Uint8Array }) => void) | null;
}
interface Access {
  inputs: Map<string, MidiPort>;
  outputs: Map<string, MidiPort>;
  onstatechange: (() => void) | null;
}
export class MidiDevices {
  access: Access | null = null;
  input: MidiPort | null = null;
  output: MidiPort | null = null;
  private sounding = new Set<number>();
  constructor(
    private change: () => void,
    private message: (data: Uint8Array) => void,
    private disconnected: () => void,
  ) {}
  async connect() {
    const navigatorMidi = navigator as unknown as {
      requestMIDIAccess?: () => Promise<Access>;
    };
    if (!navigatorMidi.requestMIDIAccess)
      throw Error(
        "当前浏览器无法连接 MIDI。iPad 请用 MIDIWeb Browser；电脑请用 Chrome / Edge 的 HTTPS 或 localhost 页面。",
      );
    const access = await navigatorMidi.requestMIDIAccess();
    this.access = access;
    access.onstatechange = () => {
      if (this.input?.state === "disconnected") {
        this.input.onmidimessage = null;
        this.input = null;
        this.disconnected();
      }
      if (this.output?.state === "disconnected") {
        this.sounding.clear();
        this.output = null;
        this.disconnected();
      }
      this.change();
    };
    this.change();
  }
  inputs() {
    return [...(this.access?.inputs.values() ?? [])].filter(
      (p) => p.state === "connected",
    );
  }
  outputs() {
    return [...(this.access?.outputs.values() ?? [])].filter(
      (p) => p.state === "connected",
    );
  }
  selectInput(id: string) {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.access?.inputs.get(id) ?? null;
    if (this.input) this.input.onmidimessage = (e) => this.message(e.data);
  }
  selectOutput(id: string) {
    this.silence();
    this.output = this.access?.outputs.get(id) ?? null;
  }
  on(midi: number, velocity = 70) {
    if (this.output?.state !== "connected") return;
    if (this.sounding.has(midi)) this.off(midi);
    this.output.send?.([0x91, midi, velocity]);
    this.sounding.add(midi);
  }
  off(midi: number) {
    if (this.output?.state === "connected" && this.sounding.has(midi))
      this.output.send?.([0x81, midi, 0]);
    this.sounding.delete(midi);
  }
  silence() {
    if (this.output?.state === "connected") {
      for (const midi of this.sounding) this.output.send?.([0x81, midi, 0]);
      this.output.send?.([0xb1, 64, 0]);
      this.output.send?.([0xb1, 123, 0]);
    }
    this.sounding.clear();
  }
  dispose() {
    this.silence();
    if (this.input) this.input.onmidimessage = null;
    if (this.access) this.access.onstatechange = null;
  }
}
