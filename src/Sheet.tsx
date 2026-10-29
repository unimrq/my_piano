import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { compactChordFingerings } from "./fingering";
import type { Trainer, NoteFeedback } from "./trainer";
import {
  OpenSheetMusicDisplay,
  SkyBottomLineBatchCalculatorBackendType,
} from "opensheetmusicdisplay";
export default function Sheet({
  xml,
  beat,
  trainer,
  onSeek,
  loopTool,
  onLoop,
}: {
  xml: string;
  beat: number;
  trainer: Trainer;
  onSeek: (beat: number) => void;
  loopTool: boolean;
  onLoop: (range: [number, number]) => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const dragging = useRef<{
    x: number;
    y: number;
    left: number;
    moved: boolean;
    measure?: number;
  } | null>(null);
  const manualUntil = useRef(0);
  const latest = useRef(trainer);
  latest.current = trainer;
  type GNote =
    OpenSheetMusicDisplay["GraphicSheet"]["MeasureList"][number][number]["staffEntries"][number]["graphicalVoiceEntries"][number]["notes"][number];
  const graphical = useRef<
    {
      id: string;
      beat: number;
      note: GNote;
      element: SVGGraphicsElement;
      color?: string;
    }[]
  >([]);
  const [marks, setMarks] = useState<
    { id: string; x: number; y: number; value: NoteFeedback }[]
  >([]);
  const revision = trainer.feedbackRevision;
  const [anchors, setAnchors] = useState<{ beat: number; x: number }[]>([]);
  const [measures, setMeasures] = useState<
    { number: number; left: number; right: number }[]
  >([]);
  const [loopDraft, setLoopDraft] = useState<[number, number] | null>(null);
  const measureAt = (clientX: number) => {
    const x = clientX - surface.current!.getBoundingClientRect().left;
    return (measures.findLast((m) => m.left <= x) ?? measures[0]).number;
  };
  useEffect(() => {
    dragging.current = null;
    setLoopDraft(null);
  }, [loopTool, xml]);
  const seekAt = (clientX: number) => {
    const x = clientX - surface.current!.getBoundingClientRect().left;
    return anchors.reduce(
      (nearest, a) =>
        Math.abs(a.x - x) < Math.abs(nearest.x - x) ? a : nearest,
      anchors[0],
    );
  };
  useEffect(() => {
    const viewport = surface.current!.parentElement!;
    const wheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      const scale =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientWidth
            : 1;
      viewport.scrollLeft += delta * scale;
      manualUntil.current = Date.now() + 3000;
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, []);
  const host = useRef<HTMLDivElement>(null),
    api = useRef<OpenSheetMusicDisplay | null>(null),
    position = useRef(-1),
    cursorIndex = useRef(0),
    cursorTimes = useRef<number[]>([]);
  const [error, setError] = useState("");
  const [renderVersion, setRenderVersion] = useState(0);
  useEffect(() => {
    if (!host.current) return;
    const holder = host.current;
    holder.replaceChildren();
    holder.setAttribute("aria-busy", "true");
    let disposed = false;
    setError("");
    const display = new OpenSheetMusicDisplay(holder, {
      autoResize: false,
      autoBeam:
        trainer.song.source === "midi" ||
        trainer.song.warning?.startsWith("自动转谱"),
      alignRests: 2,
      backend: "svg",
      preferredSkyBottomLineBatchCalculatorBackend:
        SkyBottomLineBatchCalculatorBackendType.Plain,
      defaultColorMusic: "#1b1c20",
      drawTitle: false,
      drawSubtitle: false,
      drawComposer: false,
      drawMetronomeMarks: false,
      drawPartNames: false,
      drawPartAbbreviations: false,
      drawMeasureNumbers: true,
      fingeringPosition: "below",
      drawFingerings: true,
      fingeringInsideStafflines: false,
      followCursor: false,
      drawingParameters: "compacttight",
      renderSingleHorizontalStaffline: true,
    });
    api.current = display;
    display.EngravingRules.FingeringPositionFromXML = false;
    display.EngravingRules.AlwaysSetPreferredSkyBottomLineBackendAutomatically = false;
    let timer: ReturnType<typeof setTimeout>;
    let naturalWidth = 0,
      naturalHeight = 0,
      lastWidth = 0,
      lastHeight = 0;
    const alignFingerings = () => {
      const rows = new Map<number, SVGTextElement[][]>();
      for (const measure of display.GraphicSheet.MeasureList)
        measure.forEach((staff, index) => {
          for (const entry of staff.staffEntries) {
            const labels = entry.FingeringEntries.flatMap((label) => {
              const node = label.SVGNode;
              const text =
                node instanceof SVGTextElement
                  ? node
                  : node instanceof Element
                    ? node.querySelector<SVGTextElement>("text")
                    : null;
              return text ? [text] : [];
            });
            if (!labels.length) continue;
            const row = rows.get(index) ?? [];
            row.push(labels);
            rows.set(index, row);
          }
        });
      for (const [index, entries] of rows) {
        const baseline = Math.max(
          ...entries.flat().map((text) => Number(text.getAttribute("y"))),
        );
        for (const labels of entries) {
          const offset =
            baseline -
            Math.max(...labels.map((text) => Number(text.getAttribute("y"))));
          // Preserve stacked chord fingerings; align their bottom digit with the row.
          for (const text of labels) {
            text.setAttribute(
              "y",
              String(Number(text.getAttribute("y")) + offset),
            );
            text.dataset.fingeringRow = String(index);
          }
        }
      }
    };
    const render = () => {
      if (disposed) return;
      const viewport = surface.current!.parentElement!;
      if (
        naturalHeight &&
        viewport.clientWidth === lastWidth &&
        viewport.clientHeight === lastHeight
      )
        return;
      if (!naturalHeight) {
        display.Zoom = 1;
        display.render();
        alignFingerings();
        const svg = host.current!.querySelector("svg")!;
        naturalWidth = svg.width.baseVal.value;
        naturalHeight = svg.height.baseVal.value;
        svg.setAttribute("viewBox", `0 0 ${naturalWidth} ${naturalHeight}`);
      }
      lastWidth = viewport.clientWidth;
      lastHeight = viewport.clientHeight;
      // Resize the existing vector drawing instead of engraving the whole piece again.
      const scale = Math.max(
        0.05,
        Math.min(2, (lastHeight - 24) / naturalHeight),
      );
      const svg = host.current!.querySelector("svg")!;
      svg.setAttribute("width", String(naturalWidth * scale));
      svg.setAttribute("height", String(naturalHeight * scale));
      const cursor = display.cursor;
      cursor.reset();
      graphical.current = [];
      const exercise = latest.current.song.notes;
      const byPitch = new Map<number, typeof exercise>();
      for (const note of exercise) {
        const bucket = byPitch.get(note.midi) ?? [];
        bucket.push(note);
        byPitch.set(note.midi, bucket);
      }
      const allocated = new Set<string>();
      const origin =
        host.current!.querySelector("svg")!.getBoundingClientRect().left -
        surface.current!.getBoundingClientRect().left;
      setMeasures(
        display.GraphicSheet.MeasureList.map((measure, index) => {
          // VexFlow stores the actual bar geometry before OSMD's SVG zoom.
          const stave = (
            measure[0] as (typeof measure)[0] & {
              getVFStave(): { getX(): number; getWidth(): number };
            }
          ).getVFStave();
          const left = origin + stave.getX() * scale;
          return {
            number: index + 1,
            left,
            right: left + stave.getWidth() * scale,
          };
        }),
      );
      for (const [
        measureIndex,
        measure,
      ] of display.GraphicSheet.MeasureList.entries())
        for (const staff of measure)
          for (const entry of staff.staffEntries)
            for (const voice of entry.graphicalVoiceEntries)
              for (const note of voice.notes) {
                if (!note.sourceNote.Pitch) continue;
                const midi = note.sourceNote.Pitch.getHalfTone() + 12;
                const onset =
                  note.sourceNote.getAbsoluteTimestamp().RealValue * 4;
                const match = (byPitch.get(midi) ?? [])
                  .filter(
                    (n) =>
                      n.midi === midi &&
                      (Math.abs(n.beat - onset) <= 0.13 ||
                        (n.beat < onset && n.beat + n.duration > onset + 0.01)),
                  )
                  .sort(
                    (a, b) =>
                      Math.abs(a.beat - onset) - Math.abs(b.beat - onset),
                  )
                  .find((n) => !allocated.has(`${n.id}:${onset}`));
                if (!match) continue;
                allocated.add(`${match.id}:${onset}`);
                const vex = note as GNote & {
                  getSVGGElement(): SVGGElement;
                  vfnote: [unknown, number];
                };
                const group = vex.getSVGGElement();
                const element = group
                  ? (group.querySelectorAll<SVGGraphicsElement>(".vf-notehead")[
                      vex.vfnote[1]
                    ] ?? group)
                  : null;
                if (element) {
                  element.dataset.noteId = match.id;
                  element.dataset.measure = String(measureIndex + 1);
                  graphical.current.push({
                    id: match.id,
                    beat: match.beat,
                    note,
                    element,
                  });
                }
              }
      const times: number[] = [];
      while (!cursor.Iterator.EndReached && times.length < 100000) {
        times.push(cursor.Iterator.currentTimeStamp.RealValue);
        cursor.Iterator.moveToNext();
      }
      cursor.reset();
      cursorTimes.current = times;
      cursorIndex.current = 0;
      display.cursor.hide();
      position.current = -1;
      setRenderVersion((v) => v + 1);
      holder.setAttribute("aria-busy", "false");
    };
    // Tempo is shown in the toolbar; keep the original file and note data intact.
    const displayDocument = new DOMParser().parseFromString(
      xml,
      "application/xml",
    );
    compactChordFingerings(displayDocument, trainer.settings.split);
    for (const direction of displayDocument.querySelectorAll("direction")) {
      if (direction.querySelector("metronome, sound[tempo]"))
        for (const label of direction.querySelectorAll(
          "direction-type > words, direction-type > metronome",
        ))
          label.remove();
    }
    display
      .load(displayDocument)
      .then(() => {
        if (!disposed) {
          display.Sheet.Repetitions = [];
          render();
        }
      })
      .catch((e) => {
        if (!disposed) {
          holder.setAttribute("aria-busy", "false");
          setError("曲谱显示失败：" + String(e));
        }
      });
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (display.Sheet) render();
      }, 160);
    });
    observer.observe(surface.current!.parentElement!);
    return () => {
      disposed = true;
      clearTimeout(timer);
      observer.disconnect();
      display.clear();
      holder.replaceChildren();
      graphical.current = [];
      api.current = null;
    };
  }, [xml]);
  useEffect(() => {
    position.current = -1;
    manualUntil.current = 0;
  }, [trainer]);
  useEffect(() => {
    const display = api.current;
    if (!display?.Sheet || !display.cursor?.Iterator) return;
    const target = Math.max(0, beat) / 4;
    const cursor = display.cursor;
    const index = Math.max(
      0,
      cursorTimes.current.findLastIndex((t) => t <= target + 0.001),
    );
    if (index < cursorIndex.current) {
      cursor.reset();
      cursorIndex.current = 0;
    }
    while (cursorIndex.current < index && !cursor.Iterator.EndReached) {
      cursor.next();
      cursorIndex.current++;
    }
    const firstPosition = position.current < 0;
    position.current = target;
    cursor.hide();
    const scroll = surface.current?.parentElement;
    const anchor =
      anchors.findLast((a) => a.beat <= beat + 0.001) ?? anchors[0];
    if (
      scroll &&
      anchor &&
      !dragging.current &&
      Date.now() >= manualUntil.current &&
      (trainer.running || firstPosition)
    )
      scroll.scrollLeft = Math.max(0, anchor.x - scroll.clientWidth * 0.35);
  }, [beat, renderVersion, trainer, trainer.running, anchors]);
  useEffect(() => {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return;
    const colors = {
      correct: "#4b927e",
      early: "#b1873e",
      late: "#b1873e",
      wrong: "#c36666",
      missed: "#a56f79",
    };
    const next: typeof marks = [];
    const seen = new Set<string>();
    const points = new Map<number, number>();
    // Batch geometry reads before changing colors to avoid one layout per note.
    const boxes = graphical.current.map((item) =>
      item.element.getBoundingClientRect(),
    );
    for (const [index, item] of graphical.current.entries()) {
      const value = trainer.feedback.get(item.id);
      const color = value ? colors[value.status] : "#1b1c20";
      if ((value || item.color) && item.color !== color) {
        item.note.setColor(color, {
          applyToBeams: false,
          applyToFlag: false,
          applyToLedgerLines: false,
        });
        item.color = color;
      }
      const box = boxes[index];
      if (!box.width || !box.height) continue;
      const x = box.left - rect.left + box.width / 2;
      points.set(item.beat, Math.min(points.get(item.beat) ?? Infinity, x));
      if (!value || seen.has(item.id)) continue;
      seen.add(item.id);
      next.push({
        id: item.id,
        x: box.left - rect.left + box.width / 2,
        y: box.bottom - rect.top + 5,
        value,
      });
    }
    setMarks(next);
    const positions = [...points]
      .map(([beat, x]) => ({ beat, x }))
      .sort((a, b) => a.beat - b.beat);
    setAnchors((old) =>
      old.length === positions.length &&
      old.every(
        (a, i) =>
          a.beat === positions[i].beat && Math.abs(a.x - positions[i].x) < 0.5,
      )
        ? old
        : positions,
    );
  }, [trainer, revision, renderVersion]);
  const describe = (value: NoteFeedback) => {
    const label = {
      correct: "起音正确",
      early: "偏早",
      late: "偏晚",
      wrong: "此处出现错音或超出起音容差",
      missed: "漏音",
    }[value.status];
    return `${label}${value.offsetMs === undefined ? "" : ` ${value.offsetMs} ms`}${value.short ? `；按键时值不足：${value.heldMs} / ${value.expectedMs} ms` : ""}${value.wrongAttempts ? `；错弹 ${value.wrongAttempts} 次` : ""}`;
  };
  const range =
    loopDraft ??
    (trainer.settings.loop
      ? [trainer.settings.from, trainer.settings.to]
      : null);
  const loopStart = range && measures.find((m) => m.number === range[0]);
  const loopEnd = range && measures.find((m) => m.number === range[1]);
  return (
    <div
      ref={surface}
      className={loopTool ? "score-surface selecting-loop" : "score-surface"}
      title={loopTool ? "拖选循环小节，滚轮浏览" : "滚轮或拖动浏览，单击定位"}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const scroll = event.currentTarget.parentElement!;
        dragging.current = {
          x: event.clientX,
          y: event.clientY,
          left: scroll.scrollLeft,
          moved: false,
          measure:
            loopTool && measures.length ? measureAt(event.clientX) : undefined,
        };
        if (dragging.current.measure !== undefined)
          setLoopDraft([dragging.current.measure, dragging.current.measure]);
        manualUntil.current = Date.now() + 3000;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = dragging.current;
        if (!start) return;
        if (start.measure !== undefined) {
          const current = measureAt(event.clientX);
          setLoopDraft([
            Math.min(start.measure, current),
            Math.max(start.measure, current),
          ]);
          return;
        }
        const scroll = event.currentTarget.parentElement!;
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5)
          start.moved = true;
        if (start.moved)
          scroll.scrollLeft = start.left + start.x - event.clientX;
      }}
      onPointerUp={(event) => {
        const start = dragging.current;
        dragging.current = null;
        manualUntil.current = Date.now() + 3000;
        if (start?.measure !== undefined) {
          const current = measureAt(event.clientX);
          onLoop([
            Math.min(start.measure, current),
            Math.max(start.measure, current),
          ]);
          setLoopDraft(null);
          return;
        }
        if (start && !start.moved && anchors.length)
          onSeek(seekAt(event.clientX).beat);
      }}
      onPointerCancel={() => {
        dragging.current = null;
        setLoopDraft(null);
      }}
    >
      <div className="sheet-host" ref={host} />
      {loopStart && loopEnd && (
        <div
          className="score-loop-range"
          data-from={range![0]}
          data-to={range![1]}
          aria-label={`循环第 ${range![0]} 至 ${range![1]} 小节`}
          style={{
            left: loopStart.left,
            width: loopEnd.right - loopStart.left,
          }}
        />
      )}
      {anchors.length > 0 && (
        <div
          className="score-playhead"
          style={{
            left: (
              anchors.findLast((a) => a.beat <= beat + 0.001) ?? anchors[0]
            ).x,
          }}
        ></div>
      )}
      <div className="score-feedback-layer" aria-label="谱面反馈">
        {marks.map((mark) => (
          <span
            key={mark.id}
            data-note-id={mark.id}
            data-status={mark.value.status}
            className={`score-mark ${mark.value.status}`}
            style={{ left: mark.x, top: mark.y }}
            title={describe(mark.value)}
          >
            {mark.value.status === "correct" ? (
              <Icon name="check" />
            ) : mark.value.status === "wrong" ? (
              <Icon name="close" />
            ) : (
              { early: "早", late: "晚", missed: "漏" }[mark.value.status]
            )}
            {mark.value.short && <b className="short-note">短</b>}
          </span>
        ))}
      </div>
      {error && <div className="sheet-error">{error}</div>}
    </div>
  );
}
