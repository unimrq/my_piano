import { useEffect, useMemo, useRef, useState } from "react";
import "pixi.js/unsafe-eval"; // CSP-safe precompiled sync functions, no eval permission needed.
import {
  beatToSeconds,
  practiceNotes,
  playbackNotes,
  DEFAULT_MIN_WHITE_KEYS,
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
  pitches,
  onInput,
}: {
  song: Song;
  settings: Settings;
  trainer: Trainer;
  pitches: number[];
  onInput: (data: number[]) => void;
}) {
  const [viewport] = useState(() => {
    const current = new KeyboardRange();
    current.reset(pitches);
    current.update(
      [],
      settings.minWhiteKeys ?? DEFAULT_MIN_WHITE_KEYS,
      settings.registerMode ?? "follow",
      performance.now() / 1000,
    );
    return { current };
  });
  const [range, setRange] = useState<[number, number]>(viewport.current.range);
  const surface = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null),
    rollCanvas = useRef<HTMLCanvasElement>(null),
    keyCanvas = useRef<HTMLCanvasElement>(null),
    roll = useRef<FallingNotesRenderer | null>(null),
    keyboard = useRef<PianoKeyboard | null>(null),
    latest = useRef({ song, settings, trainer, onInput }),
    last = useRef(-Infinity),
    spawned = useRef(new Set<string>()),
    held = useRef(new Set<number>()),
    demonstrated = useRef(new Map<number, NoteEvent>());
  const [error, setError] = useState("");
  latest.current = { song, settings, trainer, onInput };
  const notes = useMemo<NoteEvent[]>(
    () =>
      (settings.mode === "listen"
        ? playbackNotes(song, settings)
        : practiceNotes(song, settings)
      ).map((n) => ({
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
    [song, settings.mode, settings.hand, settings.split, settings.backing],
  );
  const notesRef = useRef(notes);
  notesRef.current = notes;
  useEffect(() => viewport.current.reset(pitches), [pitches]);
  useEffect(() => {
    if (!host.current || !rollCanvas.current || !keyCanvas.current) return;
    const holder = host.current;
    let disposed = false,
      frame = 0;
    let previousTrainer = latest.current.trainer;
    let wasRunning = false;
    let restoreKeys = false;
    let previousFrame = performance.now();
    const motion = !window.matchMedia("(prefers-reduced-motion: reduce)")
      .matches;
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
      onKeyPress: (midi) => latest.current.onInput([144, midi, 96]),
      onKeyRelease: (midi) => latest.current.onInput([128, midi, 0]),
      onPan: (delta, active) => {
        holder.toggleAttribute("data-panning", active);
        if (delta)
          setRange(
            viewport.current.pan(
              (-delta *
                Math.round(
                  viewport.current.range[1] - viewport.current.range[0],
                )) /
                holder.clientWidth,
              performance.now() / 1000,
            ),
          );
      },
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
          const now = performance.now();
          const deltaFrames = Math.min(3, ((now - previousFrame) / 1000) * 60);
          previousFrame = now;
          if (trainer !== previousTrainer) {
            falling.reset();
            keys.reset();
            spawned.current.clear();
            held.current.clear();
            demonstrated.current.clear();
            restoreKeys = false;
            last.current = -Infinity;
            previousTrainer = trainer;
          }
          if (wasRunning && !trainer.running) falling.clearEffects();
          wasRunning = trainer.running;
          const time = beatToSeconds(trainer.beat, song.tempos);
          const startTime = beatToSeconds(trainer.start, song.tempos);
          const mode = latest.current.settings.registerMode ?? "follow";
          const minimum =
            latest.current.settings.minWhiteKeys ?? DEFAULT_MIN_WHITE_KEYS;
          const focus =
            trainer.settings.mode === "wait"
              ? trainer.target.map((n) => n.midi)
              : notesRef.current
                  .filter(
                    (n) => n.endSeconds > time && n.startSeconds <= time + 0.35,
                  )
                  .map((n) => n.midi);
          const before = viewport.current.range;
          const next = viewport.current.update(
            [...focus, ...trainer.held.keys()],
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
          const sounding = new Map(
            trainer.settings.mode === "listen" && trainer.running
              ? notesRef.current
                  .filter(
                    (n) =>
                      n.startSeconds >= startTime &&
                      n.startSeconds <= time &&
                      n.endSeconds > time,
                  )
                  .map((n) => [n.midi, n] as const)
              : [],
          );
          for (const [midi, note] of demonstrated.current)
            if (!sounding.has(midi)) keys.noteOff(note, "playback");
          for (const [midi, note] of sounding) {
            const onset = demonstrated.current.get(midi)?.id !== note.id;
            if (onset || restoreKeys) {
              keys.noteOn(note, "playback", onset);
              if (onset && motion) falling.strike(note);
            }
          }
          demonstrated.current = sounding;
          keyCanvas.current?.setAttribute(
            "aria-description",
            guide.length
              ? `待弹：${guide.map((n) => midiToPitch(n.midi)).join("、")}`
              : sounding.size
                ? `示范：${[...sounding.keys()].map((midi) => midiToPitch(midi)).join("、")}`
                : "当前没有待弹音",
          );
          falling.showGhost(null);
          for (const m of held.current)
            if (!trainer.held.has(m)) keys.inputNoteOff(m);
          for (const m of trainer.held.keys()) {
            const onset = !held.current.has(m);
            if (motion && trainer.running && !sounding.has(m))
              falling.contact(
                {
                  midi: m,
                  hand: m < latest.current.settings.split ? "left" : "right",
                },
                deltaFrames,
              );
            if (!onset && !restoreKeys) continue;
            const hand = notesRef.current.findLast(
              (n) => n.midi === m && n.startSeconds <= time + 0.01,
            )?.hand;
            const side =
              hand === "left" || hand === "right"
                ? hand
                : m < latest.current.settings.split
                  ? "left"
                  : "right";
            keys.inputNoteOn(m, trainer.wrongKey === m, side, onset);
            if (onset && motion) falling.strike({ midi: m, hand: side });
          }
          if (motion && trainer.running)
            for (const note of sounding.values())
              falling.contact(note, deltaFrames);
          if (redraw) falling.tick(time);
          else falling.advanceEffects(deltaFrames);
          held.current = new Set(trainer.held.keys());
          restoreKeys = false;
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
        restoreKeys = true;
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
      demonstrated.current.clear();
    };
  }, []);
  useEffect(() => {
    roll.current?.reset();
    keyboard.current?.reset();
    spawned.current.clear();
    held.current.clear();
    demonstrated.current.clear();
    last.current = -Infinity;
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
      data-visible-whites={Math.round(range[1] - range[0])}
      data-first-white={range[0]}
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
