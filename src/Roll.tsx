import { useEffect, useMemo, useRef, useState } from "react";
import "pixi.js/unsafe-eval"; // CSP-safe precompiled sync functions, no eval permission needed.
import {
  beatToSeconds,
  practiceNotes,
  type Song,
  type Settings,
} from "./model";
import type { Trainer } from "./trainer";
import { FallingNotesRenderer } from "./vendor/bach/FallingNotesRenderer";
import { PianoKeyboard } from "./vendor/bach/PianoKeyboard";
import { midiToPitch, type NoteEvent } from "./vendor/bach/MusicData";
import { KeyboardRange } from "./keyboardRange";
// Thin adapter: timing/scoring stay outside the MIT upstream renderers.
export default function Roll({
  song,
  settings,
  trainer,
}: {
  song: Song;
  settings: Settings;
  trainer: Trainer;
}) {
  const [range, setRange] = useState<[number, number]>([21, 42]);
  const viewport = useRef(new KeyboardRange());
  const surface = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null),
    rollCanvas = useRef<HTMLCanvasElement>(null),
    keyCanvas = useRef<HTMLCanvasElement>(null),
    roll = useRef<FallingNotesRenderer | null>(null),
    keyboard = useRef<PianoKeyboard | null>(null),
    latest = useRef({ song, settings, trainer }),
    last = useRef(-Infinity),
    spawned = useRef(new Set<string>()),
    held = useRef(new Set<number>());
  const [error, setError] = useState("");
  latest.current = { song, settings, trainer };
  const notes = useMemo<NoteEvent[]>(
    () =>
      practiceNotes(song, settings).map((n) => ({
        id: n.id,
        midi: n.midi,
        pitch: midiToPitch(n.midi),
        startTick: n.beat * 480,
        durationTick: n.duration * 480,
        startSeconds: beatToSeconds(n.beat, song.tempos),
        endSeconds: beatToSeconds(n.beat + n.duration, song.tempos),
        hand: n.hand,
        finger: null,
        velocity: n.velocity,
        channel: 0,
      })),
    [song, settings],
  );
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => {
    if (!host.current || !rollCanvas.current || !keyCanvas.current) return;
    let disposed = false,
      frame = 0;
    const width = surface.current!.clientWidth;
    const keyHeight = () =>
      Math.round(
        Math.max(160, Math.min(250, host.current!.clientHeight * 0.4)),
      );
    host.current.style.setProperty("--key-height", `${keyHeight()}px`);
    keyCanvas.current.style.height = `${keyHeight()}px`;
    keyCanvas.current.style.flexBasis = `${keyHeight()}px`;
    const colors = {
      rightHand: "#68d69a",
      leftHand: "#b19afa",
      unknown: "#88a7bb",
    };
    const falling = new FallingNotesRenderer({
      width,
      height: Math.max(100, host.current.clientHeight - keyHeight()),
      viewportSeconds: 5,
      showFingering: false,
      showHandColors: true,
      useFlats: false,
      noteFilter: "all",
      colorTheme: "custom",
      customColors: colors,
      showGrid: true,
      showMeasureNums: true,
      impactStyle: "off",
      showBeatLines: true,
      darkMode: true,
    });
    const keys = new PianoKeyboard(keyCanvas.current, {
      width,
      height: keyHeight(),
      noteLabelMode: "numbers",
      pianoTheme: "white",
      showFingering: false,
      showHandColors: true,
      useFlats: false,
      customColors: colors,
    });
    Promise.all([
      falling.init(rollCanvas.current),
      keys.init(keyCanvas.current),
    ])
      .then(() => {
        if (disposed) {
          falling.destroy();
          keys.destroy();
          return;
        }
        roll.current = falling;
        keyboard.current = keys;
        last.current = -Infinity;
        const current = latest.current.song;
        falling.setOptions({
          measureStarts: current.measures.map((m) =>
            beatToSeconds(m.beat, current.tempos),
          ),
        });
        const animate = () => {
          if (disposed) return;
          const { song, trainer } = latest.current;
          const time = beatToSeconds(trainer.beat, song.tempos);
          const mode = latest.current.settings.registerMode ?? "follow";
          const minimum = latest.current.settings.minWhiteKeys ?? 21;
          const upcoming = notesRef.current
            .filter((n) => n.endSeconds >= time && n.startSeconds <= time + 5)
            .map((n) => n.midi);
          const before = viewport.current.range;
          const next = viewport.current.update(
            [
              ...upcoming,
              ...trainer.held.keys(),
              ...trainer.target.map((n) => n.midi),
            ],
            minimum,
            mode,
            performance.now() / 1000,
          );
          if (next !== before) setRange(next);
          let redraw = time !== last.current;
          if (time < last.current - 0.001) {
            falling.reset();
            spawned.current.clear();
          }
          last.current = time;
          for (const n of notesRef.current) {
            if (n.startSeconds > time + 5) break;
            if (n.endSeconds >= time - 0.1 && !spawned.current.has(n.id)) {
              falling.addNote(n, time);
              spawned.current.add(n.id);
              redraw = true;
            }
          }
          if (redraw) falling.tick(time);
          const guide =
            trainer.settings.mode === "listen"
              ? []
              : trainer.settings.mode === "wait"
                ? trainer.target
                : trainer.notes.filter(
                    (n) =>
                      !trainer.isHit(n.id) &&
                      n.beat >= trainer.beat - 0.001 &&
                      beatToSeconds(n.beat, song.tempos) - time <= 0.6,
                  );
          keys.setTargets(guide);
          keyCanvas.current?.setAttribute(
            "aria-description",
            guide.length
              ? `待弹：${guide.map((n) => midiToPitch(n.midi)).join("、")}`
              : "当前没有待弹音",
          );
          falling.showGhost(null);
          for (const m of held.current)
            if (!trainer.held.has(m)) keys.inputNoteOff(m);
          for (const m of trainer.held.keys()) {
            if (held.current.has(m)) continue;
            const hand = notesRef.current.findLast(
              (n) => n.midi === m && n.startSeconds <= time + 0.01,
            )?.hand;
            keys.inputNoteOn(
              m,
              trainer.wrongKey === m,
              hand === "left" || hand === "right"
                ? hand
                : m < latest.current.settings.split
                  ? "left"
                  : "right",
            );
          }
          held.current = new Set(trainer.held.keys());
          frame = requestAnimationFrame(animate);
        };
        animate();
      })
      .catch((e) => {
        if (!disposed) setError("渲染初始化失败：" + String(e));
      });
    const observer = new ResizeObserver(() => {
      if (roll.current) {
        const w = surface.current!.clientWidth,
          h = Math.max(100, host.current!.clientHeight - keyHeight());
        falling.resize(w, h);
        keys.resize(w, keyHeight());
        host.current!.style.setProperty("--key-height", `${keyHeight()}px`);
        keyCanvas.current!.style.height = `${keyHeight()}px`;
        keyCanvas.current!.style.flexBasis = `${keyHeight()}px`;
        spawned.current.clear();
        held.current.clear();
        last.current = -Infinity;
      }
    });
    observer.observe(surface.current!);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      if (roll.current) {
        falling.destroy();
        keys.destroy();
        roll.current = null;
        keyboard.current = null;
      }
      spawned.current.clear();
      held.current.clear();
    };
  }, []);
  useEffect(() => {
    roll.current?.reset();
    keyboard.current?.reset();
    spawned.current.clear();
    held.current.clear();
    last.current = -Infinity;
    viewport.current.reset();
    roll.current?.setOptions({
      measureStarts: song.measures.map((m) =>
        beatToSeconds(m.beat, song.tempos),
      ),
      beatStarts: song.measures.flatMap((m) =>
        Array.from({ length: m.beats }, (_, i) =>
          beatToSeconds(m.beat + (i * 4) / m.beatType, song.tempos),
        ),
      ),
    });
  }, [notes, song]);
  return (
    <div
      ref={host}
      className="roll-keyboard upstream-renderer"
      data-visible-whites={range[1] - range[0]}
    >
      <div
        ref={surface}
        className="roll-surface"
        style={{
          width: `${5200 / (range[1] - range[0])}%`,
          transform: `translateX(${(-range[0] * 100) / 52}%)`,
        }}
      >
        <canvas
          className="upstream-roll"
          ref={rollCanvas}
          aria-label="下落音符"
        />
        <canvas
          className="upstream-keys"
          ref={keyCanvas}
          aria-label="实时键盘"
        />
      </div>
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
