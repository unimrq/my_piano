import * as PIXI from "pixi.js";
import { isBlackKey, midiToPitch, midiToNoteName } from "./MusicData";
import type { NoteEvent } from "./MusicData";
import type { CustomColors, NoteLabelMode } from "./options";
import { hexToNum } from "./colorUtils";

// ── Layout constants ──────────────────────────────────────────────────────────
const MIDI_MIN = 21; // A0
const MIDI_MAX = 108; // C8

function isWhite(midi: number) {
  return !isBlackKey(midi);
}
const WHITE_KEYS = Array.from(
  { length: MIDI_MAX - MIDI_MIN + 1 },
  (_, i) => MIDI_MIN + i,
).filter(isWhite);
const WHITE_COUNT = WHITE_KEYS.length;

// ── Color tokens ──────────────────────────────────────────────────────────────
const C_LABEL = 0x343a46;
const C_FINGER = 0xffffff;
const C_PLAYBACK = 0x94a9db;
const C_INPUT = 0x68d69a;
const C_LEFT = 0xb19afa;
const C_RIGHT = 0x68d69a;

export interface PianoKeyboardOptions {
  width: number;
  height: number;
  noteLabelMode: NoteLabelMode;
  pianoTheme: "white" | "ivory";
  showFingering: boolean;
  showHandColors: boolean;
  useFlats: boolean;
  customColors?: CustomColors;
  onKeyPress?: (midi: number) => void;
  onKeyRelease?: (midi: number) => void;
  onPan?: (deltaX: number, active: boolean) => void;
}

interface KeyState {
  wrong?: boolean;
  target?: "left" | "right";
  playbackActive: boolean;
  inputActive: boolean;
  hand: "left" | "right" | null;
  finger: number | null;
  hovered: boolean;
}
interface KeyPointer {
  midi?: number;
  startX: number;
  lastX: number;
  panning: boolean;
  pressed: boolean;
  timer?: ReturnType<typeof setTimeout>;
}

// ── Main class ────────────────────────────────────────────────────────────────
export class PianoKeyboard {
  app: PIXI.Application;
  private _initialized = false;

  private keyContainers = new Map<number, PIXI.Container>();
  private keys = new Map<number, PIXI.Graphics>();
  private keyLabels = new Map<number, PIXI.Text>();
  private fingerLabels = new Map<number, PIXI.Text>();
  private keyStates = new Map<number, KeyState>();
  private opts: PianoKeyboardOptions;

  private whiteW = 0;
  private whiteH = 0;
  private blackW = 0;
  private blackH = 0;
  private keyX = new Map<number, number>();
  private pressFlashes = new Map<number, number>();
  private readonly animatePress = () => {
    const now = performance.now();
    for (const [midi, started] of this.pressFlashes) {
      if (now - started >= 180) this.pressFlashes.delete(midi);
      this.redrawKey(midi);
    }
  };

  private pointers = new Map<number, KeyPointer>();
  private activatePointer(pointer: KeyPointer) {
    clearTimeout(pointer.timer);
    if (pointer.pressed || pointer.panning || pointer.midi === undefined)
      return;
    if (
      ![...this.pointers.values()].some(
        (other) => other.pressed && other.midi === pointer.midi,
      )
    )
      this.opts.onKeyPress?.(pointer.midi);
    pointer.pressed = true;
  }
  private readonly onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const box = this.canvas.getBoundingClientRect();
    const x = ((event.clientX - box.left) * this.opts.width) / box.width;
    const y = ((event.clientY - box.top) * this.opts.height) / box.height;
    const black =
      y < this.blackH
        ? [...this.keyX].find(
            ([midi, left]) =>
              !isWhite(midi) && x >= left && x < left + this.blackW,
          )?.[0]
        : undefined;
    const pointer: KeyPointer = {
      midi: black ?? WHITE_KEYS[Math.floor(x / this.whiteW)],
      startX: event.clientX,
      lastX: event.clientX,
      panning: false,
      pressed: false,
    };
    this.pointers.set(event.pointerId, pointer);
    pointer.timer = setTimeout(() => this.activatePointer(pointer), 350);
    this.canvas.setPointerCapture(event.pointerId);
    this.canvas.focus({ preventScroll: true });
    event.preventDefault();
  };
  private readonly onPointerMove = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer || !this.opts.onPan || this.pointers.size > 1) return;
    if (!pointer.panning && Math.abs(event.clientX - pointer.startX) < 8)
      return;
    if (!pointer.panning) {
      clearTimeout(pointer.timer);
      if (pointer.pressed && pointer.midi !== undefined)
        this.opts.onKeyRelease?.(pointer.midi);
      pointer.pressed = false;
      pointer.panning = true;
    }
    this.opts.onPan(event.clientX - pointer.lastX, true);
    pointer.lastX = event.clientX;
  };
  private readonly onWindowPointerUp = (event: PointerEvent) => {
    const pointer = this.pointers.get(event.pointerId);
    if (!pointer) return;
    clearTimeout(pointer.timer);
    if (pointer.panning) this.opts.onPan?.(0, false);
    else if (event.type === "pointerup")
      for (const pending of this.pointers.values())
        this.activatePointer(pending);
    this.pointers.delete(event.pointerId);
    if (
      pointer.pressed &&
      pointer.midi !== undefined &&
      ![...this.pointers.values()].some(
        (other) => other.pressed && other.midi === pointer.midi,
      )
    )
      this.opts.onKeyRelease?.(pointer.midi);
  };

  constructor(
    private canvas: HTMLCanvasElement,
    opts: PianoKeyboardOptions,
  ) {
    this.opts = opts;
    this.app = new PIXI.Application();
  }

  async init(canvas: HTMLCanvasElement) {
    await this.app.init({
      canvas,
      width: this.opts.width,
      height: this.opts.height,
      backgroundAlpha: 0,
      antialias: true,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      ...(import.meta.env.DEV ? { preserveDrawingBuffer: true } : {}),
    });
    window.addEventListener("pointerup", this.onWindowPointerUp);
    window.addEventListener("pointercancel", this.onWindowPointerUp);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.tabIndex = 0;
    this.computeLayout();
    this.drawKeys();
    this.app.ticker.add(this.animatePress);
    this._initialized = true;
  }

  // ── Layout ────────────────────────────────────────────────────────────────

  private computeLayout() {
    const { width, height } = this.opts;
    this.whiteW = width / WHITE_COUNT;
    this.whiteH = height;
    this.blackW = this.whiteW * 0.58;
    this.blackH = height * 0.6;

    let wi = 0;
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (isWhite(midi)) {
        this.keyX.set(midi, wi * this.whiteW);
        wi++;
      }
    }
    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      if (!isWhite(midi)) {
        const lx = this.keyX.get(midi - 1) ?? 0;
        this.keyX.set(midi, lx + this.whiteW - this.blackW / 2);
      }
    }
  }

  private drawKeys() {
    const root = new PIXI.Container();
    const whiteLayer = new PIXI.Container();
    const blackLayer = new PIXI.Container();

    for (let midi = MIDI_MIN; midi <= MIDI_MAX; midi++) {
      const white = isWhite(midi);
      const x = this.keyX.get(midi) ?? 0;
      const w = white ? this.whiteW : this.blackW;
      const h = white ? this.whiteH : this.blackH;

      const container = new PIXI.Container();
      container.x = x;
      container.interactive = true;
      container.cursor = "pointer";

      // Draw shape
      const g = new PIXI.Graphics();
      this.paintKey(g, w, h, white, false, null, null, false);
      container.addChild(g);

      // Note label (created for every key; text/visibility set by noteLabelMode)
      {
        const labelStr = this.noteLabel(midi);
        const lFontSz = white
          ? Math.max(7, this.whiteW * 0.42)
          : Math.max(6, this.blackW * 0.55);
        const label = new PIXI.Text({
          text: labelStr,
          style: {
            fontSize: lFontSz,
            fill: white ? C_LABEL : 0xaaaaaa,
            fontFamily: "Space Grotesk, system-ui, sans-serif",
            fontWeight: "600",
            align: "center",
          },
        });
        label.anchor.set(0.5, 1);
        label.x = w / 2;
        label.y = white ? h - 5 : h - 3;
        label.visible = labelStr.length > 0;
        container.addChild(label);
        this.keyLabels.set(midi, label);
      }

      // Finger label
      const fingerText = new PIXI.Text({
        text: "",
        style: {
          fontSize: Math.max(9, this.whiteW * 0.48),
          fill: C_FINGER,
          fontFamily: "Space Grotesk, system-ui, sans-serif",
          fontWeight: "700",
        },
      });
      fingerText.anchor.set(0.5, 0.5);
      fingerText.x = w / 2;
      fingerText.y = h * 0.22;
      fingerText.visible = false;
      container.addChild(fingerText);
      this.fingerLabels.set(midi, fingerText);

      container.on("pointerover", () => {
        // Hover highlight
        const st = this.keyStates.get(midi);
        if (st && !st.hovered) {
          st.hovered = true;
          this.redrawKey(midi);
        }
      });
      container.on("pointerout", () => {
        // Remove hover highlight
        const st = this.keyStates.get(midi);
        if (st && st.hovered) {
          st.hovered = false;
          this.redrawKey(midi);
        }
      });

      this.keys.set(midi, g);
      this.keyContainers.set(midi, container);
      this.keyStates.set(midi, {
        playbackActive: false,
        inputActive: false,
        hand: null,
        finger: null,
        hovered: false,
      });

      if (white) whiteLayer.addChild(container);
      else blackLayer.addChild(container);
    }

    root.addChild(whiteLayer, blackLayer);
    this.app.stage.addChild(root);
  }

  // ── Painting ──────────────────────────────────────────────────────────────

  private paintKey(
    g: PIXI.Graphics,
    w: number,
    h: number,
    white: boolean,
    active: boolean,
    activeColor: number | null,
    _hand: "left" | "right" | null,
    hovered = false,
    target = false,
    flash = 0,
  ) {
    g.clear();
    const lit = active || target;
    if (white) {
      // A narrow front lip and side edges give the key depth without tinting
      // its playing surface. Hand colours remain a single, solid face.
      g.roundRect(0.5, 0, w - 1, h - 1, 2).fill(0xc9cdd4);
      g.roundRect(1, 0, w - 2, h - 6, 2).fill(hovered ? 0xffffff : 0xfbfbfd);
      if (lit)
        g.roundRect(1, 0, w - 2, h - 6, 2).fill({
          color: activeColor ?? C_INPUT,
          alpha: active ? 1 : 0.72,
        });
      if (flash > 0)
        g.roundRect(1, 0, w - 2, h - 6, 2).fill({
          color: 0xffffff,
          alpha: flash * 0.22,
        });
      g.rect(1, h - 7, w - 2, 5).fill(
        lit ? (activeColor ?? C_INPUT) : 0xe7e9ed,
      );
      g.rect(1, h - 7, w - 2, 5).fill({ color: 0x202633, alpha: 0.07 });
      g.rect(1, 0, 1, h - 7).fill({ color: 0xffffff, alpha: 0.65 });
      g.rect(w - 2, 0, 1, h - 7).fill({ color: 0x263044, alpha: 0.1 });
      g.rect(1, 0, w - 2, 3).fill({ color: 0x11131a, alpha: 0.1 });
      g.rect(2, h - 8, w - 4, 1).fill({ color: 0xffffff, alpha: 0.65 });
    } else {
      // Shadows stay in the black-key layer, above the white keys. The inset
      // top and front bevel read as a raised key even at a narrow zoom level.
      g.roundRect(-1.5, 3, w + 3, h + 2, 3).fill({
        color: 0x000000,
        alpha: 0.15,
      });
      g.roundRect(-0.5, 2, w + 1, h + 1, 2).fill({
        color: 0x000000,
        alpha: 0.25,
      });
      const edge = Math.min(2, w * 0.15);
      g.roundRect(0, 0, w, h - 1, 2).fill(0x080a0e);
      g.roundRect(edge, 0, w - edge * 2, h - 9, 1).fill(
        hovered ? 0x2c2f36 : 0x20232a,
      );
      if (lit)
        g.roundRect(edge, 0, w - edge * 2, h - 9, 1).fill({
          color: activeColor ?? C_INPUT,
          alpha: active ? 1 : 0.72,
        });
      if (flash > 0)
        g.roundRect(edge, 0, w - edge * 2, h - 9, 1).fill({
          color: 0xffffff,
          alpha: flash * 0.22,
        });
      g.rect(edge, h - 9, w - edge * 2, 7).fill(
        lit ? (activeColor ?? C_INPUT) : 0x11141b,
      );
      g.rect(edge, h - 9, w - edge * 2, 7).fill({
        color: 0x000000,
        alpha: 0.2,
      });
      g.rect(edge, 1, 1, h - 10).fill({ color: 0xffffff, alpha: 0.18 });
      g.rect(w - edge - 1, 1, 1, h - 10).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(edge + 1, h - 10, w - edge * 2 - 2, 1).fill({
        color: 0xffffff,
        alpha: 0.2,
      });
    }
  }

  private redrawKey(midi: number) {
    const g = this.keys.get(midi);
    const state = this.keyStates.get(midi);
    const cont = this.keyContainers.get(midi);
    if (!g || !state || !cont) return;

    const white = isWhite(midi);
    const w = white ? this.whiteW : this.blackW;
    const h = white ? this.whiteH : this.blackH;
    const active = state.playbackActive || state.inputActive;

    // 3D press: shift container down when active
    const pressOffset = active ? 2 : 0;
    cont.y = pressOffset;

    let color: number | null = null;
    if (active) {
      const cc = this.opts.customColors;
      if (this.opts.showHandColors && state.hand) {
        color =
          state.hand === "left"
            ? cc
              ? hexToNum(cc.leftHand)
              : C_LEFT
            : cc
              ? hexToNum(cc.rightHand)
              : C_RIGHT;
      } else if (state.inputActive) {
        color = C_INPUT;
      } else {
        color = cc ? hexToNum(cc.unknown) : C_PLAYBACK;
      }
      if (state.wrong) color = 0xe58d7c;
    }

    if (!active && state.target) {
      const cc = this.opts.customColors;
      color = hexToNum(
        state.target === "left"
          ? (cc?.leftHand ?? "#b6a3cb")
          : (cc?.rightHand ?? "#86a8d6"),
      );
    }
    this.paintKey(
      g,
      w,
      h,
      white,
      active,
      color,
      state.hand,
      !active && state.hovered,
      !!state.target,
      active && this.pressFlashes.has(midi)
        ? Math.max(
            0,
            1 - (performance.now() - this.pressFlashes.get(midi)!) / 180,
          ) ** 2
        : 0,
    );

    // Finger label
    const fl = this.fingerLabels.get(midi);
    if (fl) {
      fl.visible = this.opts.showFingering && active && state.finger !== null;
      if (state.finger !== null) fl.text = String(state.finger);
    }
  }

  private noteLabel(midi: number): string {
    const mode = this.opts.noteLabelMode ?? "none";
    if (mode === "none") return "";
    const white = isWhite(midi);
    if (mode === "numbers") {
      if (!white) return "";
      const number = [
        "1",
        "♯1",
        "2",
        "♯2",
        "3",
        "4",
        "♯4",
        "5",
        "♯5",
        "6",
        "♯6",
        "7",
      ][midi % 12];
      return `${number}\n${midi % 12 === 0 ? midiToPitch(midi, this.opts.useFlats) : midiToNoteName(midi, this.opts.useFlats)}`;
    }
    if (mode === "c_only") {
      // Show full pitch (e.g. "C4") only for C notes
      return midi % 12 === 0 ? midiToPitch(midi, this.opts.useFlats) : "";
    }
    if (mode === "white" && !white) return "";
    if (mode === "black" && white) return "";
    // "white", "black", "all": show note name class only (no octave)
    return midiToNoteName(midi, this.opts.useFlats);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  noteOn(note: NoteEvent, source: "playback" | "input", animate = true) {
    const state = this.keyStates.get(note.midi);
    if (!state) return;
    if (animate) this.pressFlashes.set(note.midi, performance.now());
    else this.pressFlashes.delete(note.midi);
    if (source === "playback") {
      state.playbackActive = true;
      state.hand =
        note.hand === "unknown" ? null : (note.hand as "left" | "right");
      state.finger = note.finger;
    } else {
      state.inputActive = true;
    }
    this.redrawKey(note.midi);
  }

  noteOff(note: NoteEvent, source: "playback" | "input") {
    const state = this.keyStates.get(note.midi);
    if (!state) return;
    this.pressFlashes.delete(note.midi);
    if (source === "playback") {
      state.playbackActive = false;
      if (!state.inputActive) {
        state.hand = null;
        state.finger = null;
      }
    } else {
      state.inputActive = false;
    }
    this.redrawKey(note.midi);
  }

  inputNoteOn(
    midi: number,
    wrong = false,
    hand: "left" | "right" = "right",
    animate = true,
  ) {
    const state = this.keyStates.get(midi);
    if (!state) return;
    if (!animate) this.pressFlashes.delete(midi);
    else if (!state.inputActive) this.pressFlashes.set(midi, performance.now());
    state.inputActive = true;
    state.wrong = wrong;
    state.hand = hand;
    this.redrawKey(midi);
  }

  inputNoteOff(midi: number) {
    const state = this.keyStates.get(midi);
    if (!state) return;
    this.pressFlashes.delete(midi);
    state.inputActive = false;
    this.redrawKey(midi);
  }

  reset() {
    this.pressFlashes.clear();
    for (const [midi] of this.keys) {
      const state = this.keyStates.get(midi);
      if (state) {
        state.playbackActive = false;
        state.inputActive = false;
        state.hand = null;
        state.finger = null;
        state.hovered = false;
      }
      this.redrawKey(midi);
    }
  }

  setTargets(targets: { midi: number; hand: "left" | "right" }[]) {
    const next = new Map(targets.map((n) => [n.midi, n.hand]));
    for (const [midi, state] of this.keyStates) {
      const target = next.get(midi);
      if (state.target !== target) {
        state.target = target;
        this.redrawKey(midi);
      }
    }
  }

  setOptions(opts: Partial<PianoKeyboardOptions>) {
    const needsFullRebuild =
      ("pianoTheme" in opts && opts.pianoTheme !== this.opts.pianoTheme) ||
      ("noteLabelMode" in opts &&
        opts.noteLabelMode !== this.opts.noteLabelMode) ||
      ("useFlats" in opts && opts.useFlats !== this.opts.useFlats);

    Object.assign(this.opts, opts);

    if (needsFullRebuild) {
      // Recompute layout and redraw all keys.
      this.resize(this.opts.width, this.opts.height);
      return;
    }

    // Light update: refresh note labels in place
    for (const [midi, label] of this.keyLabels) {
      const text = this.noteLabel(midi);
      label.text = text;
      label.visible = text.length > 0;
    }
    // Redraw any currently-active keys so color changes take effect immediately
    if ("customColors" in opts || "showHandColors" in opts) {
      for (const [midi, state] of this.keyStates) {
        if (state.playbackActive || state.inputActive) this.redrawKey(midi);
      }
    }
  }

  resize(width: number, height: number) {
    if (!this._initialized) return;
    this.opts.width = width;
    this.opts.height = height;
    this.app.renderer.resize(width, height);

    this.keyX.clear();
    this.keys.clear();
    this.keyContainers.clear();
    this.keyLabels.clear();
    this.fingerLabels.clear();
    this.keyStates.clear();
    this.pressFlashes.clear();
    this.app.stage.removeChildren();
    this.computeLayout();
    this.drawKeys();
  }

  destroy() {
    window.removeEventListener("pointerup", this.onWindowPointerUp);
    window.removeEventListener("pointercancel", this.onWindowPointerUp);
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    for (const pointer of this.pointers.values()) {
      clearTimeout(pointer.timer);
      if (pointer.pressed && pointer.midi !== undefined)
        this.opts.onKeyRelease?.(pointer.midi);
    }
    this.pointers.clear();
    this.pressFlashes.clear();
    this.opts.onPan?.(0, false);
    if (this._initialized) {
      this.app.destroy(false, { children: true });
    }
  }
}
