import { useEffect, useRef, useState } from "react";
import "pixi.js/unsafe-eval";
import { PianoKeyboard } from "./vendor/bach/PianoKeyboard";
import type { FreePlaySession } from "./freeSession";
import { DEFAULT_MIN_WHITE_KEYS } from "./model";
import { KeyboardRange, pianoWhites as whites } from "./keyboardRange";
export default function FreePlay({
  session,
  pitches,
  onInput,
  minWhiteKeys = DEFAULT_MIN_WHITE_KEYS,
  split = 60,
  registerMode = "follow",
  paused = false,
}: {
  session: FreePlaySession;
  pitches: number[];
  onInput: (data: number[]) => void;
  minWhiteKeys?: number;
  split?: number;
  registerMode?: "follow" | "lock" | "full";
  paused?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    keyCanvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({
    minWhiteKeys,
    split,
    registerMode,
    paused,
    onInput,
  });
  current.current = { minWhiteKeys, split, registerMode, paused, onInput };
  const [error, setError] = useState("");
  useEffect(() => {
    const holder = host.current!,
      content = surface.current!,
      plot = canvas.current!,
      input = keyCanvas.current!;
    const context = plot.getContext("2d")!;
    let disposed = false,
      frame = 0,
      width = 0,
      height = 0,
      keyHeight = 180,
      low = 16,
      count = DEFAULT_MIN_WHITE_KEYS;
    let pausedAt: number | null = null;
    let restoreKeys = false;
    const viewport = new KeyboardRange([16, 16 + DEFAULT_MIN_WHITE_KEYS]);
    viewport.reset(pitches);
    viewport.update(
      [],
      current.current.minWhiteKeys,
      current.current.registerMode,
      performance.now() / 1000,
    );
    const held = new Set<number>();
    const keys = new PianoKeyboard(input, {
      width: 100,
      height: 180,
      noteLabelMode: "numbers",
      pianoTheme: "white",
      showFingering: false,
      showHandColors: true,
      useFlats: false,
      onKeyPress: (m) => {
        if (!current.current.paused) current.current.onInput([144, m, 96]);
      },
      onKeyRelease: (m) => {
        if (!current.current.paused) current.current.onInput([128, m, 0]);
      },
      onPan: (delta, active) => {
        holder.toggleAttribute("data-panning", active);
        if (!delta) return;
        [low] = viewport.pan(
          (-delta * count) / holder.clientWidth,
          performance.now() / 1000,
        );
        holder.dataset.firstWhite = String(low);
        content.style.transform = `translateX(${(-low * 100) / 52}%)`;
      },
    });
    const layout = () => {
      [low] = viewport.range;
      count = Math.round(viewport.range[1] - low);
      holder.dataset.visibleWhites = String(count);
      holder.dataset.firstWhite = String(low);
      content.style.width = `${5200 / count}%`;
      content.style.transform = `translateX(${(-low * 100) / 52}%)`;
      width = (holder.clientWidth * 52) / count;
      keyHeight = Math.round(
        Math.min(
          Math.max(160, Math.min(250, holder.clientHeight * 0.35)),
          Math.max(72, holder.clientHeight - 80),
        ),
      );
      height = Math.max(80, holder.clientHeight - keyHeight);
      const ratio = window.devicePixelRatio || 1;
      plot.width = Math.round(width * ratio);
      plot.height = Math.round(height * ratio);
      plot.style.height = `${height}px`;
      input.style.height = `${keyHeight}px`;
      input.style.flexBasis = `${keyHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      keys.resize(width, keyHeight);
      restoreKeys = true;
    };
    const animate = () => {
      if (disposed) return;
      const realNow = performance.now() / 1000;
      if (current.current.paused) pausedAt ??= realNow;
      else if (pausedAt !== null) {
        const elapsed = realNow - pausedAt;
        for (const note of session.notes) {
          note.start += elapsed;
          if (note.end !== undefined) note.end += elapsed;
        }
        pausedAt = null;
      }
      const now = pausedAt ?? realNow;
      session.prune(now);
      const active = [...session.active.values()];
      const previous = viewport.range;
      const next = viewport.update(
        active.map((note) => note.midi),
        current.current.minWhiteKeys,
        current.current.registerMode,
        now,
      );
      if (next !== previous) {
        if (Math.round(next[1] - next[0]) !== count) layout();
        else {
          [low] = next;
          holder.dataset.firstWhite = String(low);
          content.style.transform = `translateX(${(-low * 100) / 52}%)`;
        }
      }
      context.clearRect(0, 0, width, height);
      const whiteW = width / 52,
        blackW = whiteW * 0.58,
        speed = height / 8;
      context.lineWidth = 1;
      context.strokeStyle = "#222229";
      for (let i = 0; i <= 52; i++) {
        const m = whites[i];
        if (m !== undefined && m % 12 === 0) {
          context.beginPath();
          context.moveTo(i * whiteW, 0);
          context.lineTo(i * whiteW, height);
          context.stroke();
        }
      }
      for (const note of session.notes) {
        const white = ![1, 3, 6, 8, 10].includes(note.midi % 12),
          index = whites.findLastIndex((m) => m <= note.midi);
        const x = white ? index * whiteW : (index + 1) * whiteW - blackW / 2;
        const top = Math.max(-10, height - (now - note.start) * speed);
        const bottom =
          note.end === undefined ? height : height - (now - note.end) * speed;
        const h = Math.max(5, bottom - top - 3);
        if (bottom < 0) continue;
        context.fillStyle =
          note.midi < current.current.split ? "#b19afa" : "#68d69a";
        context.globalAlpha = 0.6 + (note.velocity / 127) * 0.4;
        context.beginPath();
        context.roundRect(
          x + 2,
          top,
          Math.max(3, (white ? whiteW : blackW) - 4),
          h,
          Math.min(4, h / 2),
        );
        context.fill();
      }
      context.globalAlpha = 1;
      const pressed = new Set(active.map((n) => n.midi));
      for (const midi of held) if (!pressed.has(midi)) keys.inputNoteOff(midi);
      for (const midi of pressed)
        if (!held.has(midi) || restoreKeys)
          keys.inputNoteOn(
            midi,
            false,
            midi < current.current.split ? "left" : "right",
            !held.has(midi),
          );
      held.clear();
      for (const midi of pressed) held.add(midi);
      restoreKeys = false;
      plot.dataset.active = String(active.length);
      plot.dataset.notes = String(session.notes.length);
      plot.setAttribute(
        "aria-description",
        `按下 ${pressed.size} 个琴键${session.pedal >= 64 ? "，踏板按下" : ""}`,
      );
      frame = requestAnimationFrame(animate);
    };
    const observer = new ResizeObserver(layout);
    keys
      .init(input)
      .then(() => {
        if (disposed) {
          keys.destroy();
          return;
        }
        layout();
        observer.observe(holder);
        animate();
      })
      .catch((e) => {
        if (!disposed) setError(String(e));
      });
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      session.release(performance.now() / 1000);
      keys.destroy();
    };
  }, [session, pitches]);
  return (
    <div ref={host} className="free-play roll-keyboard upstream-renderer">
      <div ref={surface} className="roll-surface">
        <canvas ref={canvas} className="upstream-roll" aria-label="上升音符" />
        <canvas
          ref={keyCanvas}
          className="upstream-keys"
          aria-label="自由练习键盘"
        />
      </div>
      {error && <div className="banner error">{error}</div>}
    </div>
  );
}
