import { useEffect, useRef, useState } from "react";
import "pixi.js/unsafe-eval";
import { PianoKeyboard } from "./vendor/bach/PianoKeyboard";
import type { FreePlaySession } from "./freeSession";
const whites = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (m) => ![1, 3, 6, 8, 10].includes(m % 12),
);
export default function FreePlay({
  session,
  minWhiteKeys = 21,
  split = 60,
  registerMode = "follow",
}: {
  session: FreePlaySession;
  minWhiteKeys?: number;
  split?: number;
  registerMode?: "follow" | "lock" | "full";
}) {
  const host = useRef<HTMLDivElement>(null),
    surface = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null),
    keyCanvas = useRef<HTMLCanvasElement>(null);
  const current = useRef({ minWhiteKeys, split, registerMode });
  current.current = { minWhiteKeys, split, registerMode };
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
      count = 21,
      lastMove = -Infinity;
    const held = new Set<number>();
    const visibleCount = () =>
      current.current.registerMode === "full"
        ? 52
        : Math.max(7, Math.min(52, Math.round(current.current.minWhiteKeys)));
    const keys = new PianoKeyboard(input, {
      width: 100,
      height: 180,
      noteLabelMode: "numbers",
      pianoTheme: "white",
      showFingering: false,
      showHandColors: true,
      useFlats: false,
      onKeyPress: (m) => session.input([144, m, 96], performance.now() / 1000),
      onKeyRelease: (m) => session.input([128, m, 0], performance.now() / 1000),
    });
    const layout = () => {
      count = visibleCount();
      low = Math.max(0, Math.min(52 - count, low));
      content.style.width = `${5200 / count}%`;
      content.style.transform = `translateX(${(-low * 100) / 52}%)`;
      width = (holder.clientWidth * 52) / count;
      keyHeight = Math.max(160, Math.min(250, holder.clientHeight * 0.35));
      height = Math.max(80, holder.clientHeight - keyHeight);
      const ratio = window.devicePixelRatio || 1;
      plot.width = Math.round(width * ratio);
      plot.height = Math.round(height * ratio);
      plot.style.height = `${height}px`;
      input.style.height = `${keyHeight}px`;
      input.style.flexBasis = `${keyHeight}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      keys.resize(width, keyHeight);
      held.clear();
    };
    const animate = () => {
      if (disposed) return;
      const now = performance.now() / 1000;
      session.prune(now);
      if (count !== visibleCount()) layout();
      const active = [...session.active.values()];
      const recent = active.length ? active : session.notes.slice(-1);
      if (
        current.current.registerMode === "follow" &&
        recent.length &&
        now - lastMove > 2.5
      ) {
        const indices = recent.map((n) =>
          Math.max(
            0,
            whites.findLastIndex((m) => m <= n.midi),
          ),
        );
        const first = Math.min(...indices),
          last = Math.max(...indices);
        if (first < low + 1 || last >= low + count - 1) {
          low = Math.max(
            0,
            Math.min(52 - count, Math.round((first + last - count) / 2)),
          );
          content.style.transform = `translateX(${(-low * 100) / 52}%)`;
          lastMove = now;
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
        if (!held.has(midi))
          keys.inputNoteOn(
            midi,
            false,
            midi < current.current.split ? "left" : "right",
          );
      held.clear();
      for (const midi of pressed) held.add(midi);
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
  }, [session]);
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
