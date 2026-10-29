// @vitest-environment jsdom
import { it, expect } from "vitest";
import { MidiDevices } from "../src/midi";
import { defaults, playbackNotes, type Song, type Hand } from "../src/model";
const playbackSong: Song = {
  id: "playback",
  title: "playback",
  source: "midi",
  xml: "",
  duration: 4,
  measures: [
    { index: 0, beat: 0, length: 4, beats: 4, beatType: 4, label: "1" },
  ],
  tempos: [{ beat: 0, bpm: 100 }],
  tracks: ["right", "left", "backing", "ignore"].map((role, id) => ({
    id,
    role: role as "right" | "left" | "backing" | "ignore",
    name: role,
    count: 1,
    low: 48,
    high: 72,
  })),
  notes: [72, 48, 60, 67].map((midi, track) => ({
    id: String(track),
    midi,
    track,
    hand: track === 0 ? "right" : "left",
    beat: 0,
    duration: 1,
    velocity: 80,
    measure: 0,
  })),
};
it.each<Hand>(["right", "left", "both"])(
  "自由跟弹 %s 不自动发声，兼容旧伴奏开关已启用",
  (hand) => {
    expect(
      playbackNotes(playbackSong, { ...defaults, hand, backing: true }),
    ).toEqual([]);
  },
);
it("节奏模式仅在开启伴奏时播放未练习手，示范仍完整播放", () => {
  expect(
    playbackNotes(playbackSong, { ...defaults, mode: "rhythm", hand: "right" }),
  ).toEqual([]);
  expect(
    playbackNotes(playbackSong, {
      ...defaults,
      mode: "rhythm",
      hand: "right",
      backing: true,
    }).map((n) => n.midi),
  ).toEqual([48, 60]);
  expect(
    playbackNotes(playbackSong, {
      ...defaults,
      mode: "rhythm",
      hand: "left",
      backing: true,
    }).map((n) => n.midi),
  ).toEqual([72, 60]);
  expect(
    playbackNotes(playbackSong, { ...defaults, mode: "listen" }).map(
      (n) => n.midi,
    ),
  ).toEqual([72, 48, 60]);
});
it("MIDI 通道只清理软件输出，并在输入断线时暂停", async () => {
  const sent: number[][] = [];
  let paused = 0;
  const input = {
    id: "in",
    name: "FP-30X",
    type: "input",
    state: "connected",
    onmidimessage: null as unknown,
  };
  const output = {
    id: "out",
    name: "FP-30X",
    type: "output",
    state: "connected",
    send: (data: number[]) => sent.push(data),
  };
  const access = {
    inputs: new Map([["in", input]]),
    outputs: new Map([["out", output]]),
    onstatechange: null as unknown,
  };
  Object.defineProperty(navigator, "requestMIDIAccess", {
    value: async () => access,
    configurable: true,
  });
  const messages: number[][] = [];
  const device = new MidiDevices(
    () => {},
    (d) => messages.push([...d]),
    () => paused++,
  );
  await device.connect();
  device.selectInput("in");
  device.selectOutput("out");
  device.on(60, 70);
  device.on(60, 80);
  device.silence();
  expect(sent).toContainEqual([0x91, 60, 70]);
  expect(sent).toContainEqual([0x81, 60, 0]);
  expect(sent).toContainEqual([0xb1, 123, 0]);
  expect(sent.every((s) => (s[0] & 15) === 1)).toBe(true);
  (input.onmidimessage as Function)({ data: new Uint8Array([0x90, 60, 90]) });
  expect(messages).toEqual([[0x90, 60, 90]]);
  input.state = "disconnected";
  (access.onstatechange as Function)();
  expect(paused).toBe(1);
  expect(device.input).toBeNull();
  device.dispose();
  expect(access.onstatechange).toBeNull();
});
