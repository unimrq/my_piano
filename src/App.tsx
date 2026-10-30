import { useEffect, useRef, useState, useMemo } from "react";
import {
  defaults,
  DEFAULT_MIN_WHITE_KEYS,
  newId,
  playbackNotes,
  roleNote,
  beatToSeconds,
  pitchName,
  type Library,
  type Song,
  type Settings,
  type Result,
  type Role,
} from "./model";
import { Trainer } from "./trainer";
import { MidiDevices } from "./midi";
import { PianoAudio } from "./pianoAudio";
import { importScore } from "./importer";
import { makeXml } from "./notation";
import { applyFingering, generateFingering } from "./fingering";
import type { HandSize } from "./vendor/pianoplayer";
import Sheet from "./Sheet";
import Roll from "./Roll";
import FreePlay from "./FreePlay";
import { FreePlaySession } from "./freeSession";
import {
  PracticeTime,
  summarizePracticeTime,
  type PracticeSpan,
} from "./practiceTime";
import LibraryHome from "./LibraryHome";
import Icon from "./Icon";
import {
  loadBrowserLibrary,
  saveBrowserLibrary,
  backupBrowserLibrary,
  loadPracticeSpans,
  savePracticeSpans,
} from "./browserStore";
import { loadCatalogue } from "./catalogue";
import {
  browserFullscreenElement,
  fullscreenHelp,
  toggleBrowserFullscreen,
} from "./fullscreen";
const loadingSong: Song = {
  id: "loading",
  title: "",
  source: "builtin",
  xml: "",
  notes: [],
  tracks: [],
  measures: [
    { index: 0, label: "1", beat: 0, length: 4, beats: 4, beatType: 4 },
  ],
  tempos: [{ beat: 0, bpm: 72 }],
  duration: 4,
};
const initial = (): Library => ({
  version: 1,
  collection: "piano-scores-v2",
  songs: [loadingSong],
  settings: {},
  results: [],
  lastSong: "loading",
});
const practiceDate = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
function practiceDuration(ms: number) {
  const seconds = Math.floor(ms / 1000);
  if (ms > 0 && seconds === 0) return "不足1秒";
  const minutes = Math.floor(seconds / 60);
  return `${minutes >= 60 ? `${Math.floor(minutes / 60)}小时` : ""}${minutes ? `${minutes % 60}分` : ""}${seconds % 60}秒`;
}
export default function App() {
  const freeSession = useRef(new FreePlaySession());
  const practiceTime = useRef(new PracticeTime());
  const [practiceSpans, setPracticeSpans] = useState<PracticeSpan[]>([]);
  const spansRef = useRef(practiceSpans);
  spansRef.current = practiceSpans;
  const lastPracticeCheckpoint = useRef(0);
  const practiceSummary = useMemo(
    () => summarizePracticeTime(practiceSpans),
    [practiceSpans],
  );
  const piano = useRef(new PianoAudio());
  const outputRoute = useRef<"midi" | "browser">("midi");
  const playRequest = useRef(0);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [freePaused, setFreePaused] = useState(false);
  const freePausedRef = useRef(freePaused);
  freePausedRef.current = freePaused;
  const playback = useRef({ enabled: false, toggle: () => {} });
  const [handSize, setHandSize] = useState<HandSize>("M");
  const [autoFingers, setAutoFingers] = useState(true);
  const [fingerStatus, setFingerStatus] = useState("");
  const fingerAttempts = useRef(new Set<string>());
  const [home, setHome] = useState(true);
  const [settingsTab, setSettingsTab] = useState<
    "practice" | "device" | "display"
  >("practice");
  const [full, setFull] = useState(false),
    [loopTool, setLoopTool] = useState(false);

  const homeRef = useRef(home);
  homeRef.current = home;
  const [library, setLibrary] = useState<Library>(initial),
    [songId, setSongId] = useState("loading"),
    [settings, setSettings] = useState<Settings>({ ...defaults, to: 4 }),
    [panel, setPanel] = useState<
      "library" | "settings" | "history" | "help" | null
    >(null),
    [error, setError] = useState(""),
    [ready, setReady] = useState(false),
    [notice, setNotice] = useState(""),
    [, refresh] = useState(0),
    [pending, setPending] = useState<{
      song: Song;
    } | null>(null),
    [result, setResult] = useState<Result | null>(null),
    [busy, setBusy] = useState(false);
  const freePlay = settings.mode === "free";
  const readyRef = useRef(ready);
  readyRef.current = ready;
  const song = library.songs.find((s) => s.id === songId) ?? library.songs[0];
  const keyboardPitches = useMemo(() => {
    const ignored = new Set(
      song.tracks
        .filter((track) => track.role === "ignore")
        .map((track) => track.id),
    );
    return song.notes
      .filter((note) => !ignored.has(note.track))
      .map((note) => note.midi);
  }, [song]);
  const missingFingers =
    song.notes.length > 0 &&
    !song.notes.some((n) => n.finger) &&
    !/<fingering[\s>]/.test(song.xml);
  const preparingScore =
    !freePlay &&
    missingFingers &&
    (!fingerAttempts.current.has(song.id) || busy);
  const libRef = useRef(library),
    settingsRef = useRef(settings);
  libRef.current = library;
  settingsRef.current = settings;
  const [engine] = useState(() => ({ current: new Trainer(song, settings) }));
  const devices = useRef<MidiDevices | null>(null);
  const songRef = useRef(song);
  songRef.current = song;
  useEffect(() => setFingerStatus(""), [songId]);
  const [, devicesChanged] = useState(0);
  const audible = useMemo(
    () => playbackNotes(song, settings),
    [song, settings],
  );
  const audibleRef = useRef(audible);
  audibleRef.current = audible;
  const saveError = useRef(false),
    unsafeLoad = useRef(false),
    startedAt = useRef(0),
    activeMs = useRef(0),
    lastFrame = useRef(0),
    scheduled = useRef(new Map<string, { midi: number; end: number }>()),
    played = useRef(new Set<string>()),
    lastClick = useRef(-999),
    audio = useRef<AudioContext | null>(null);
  const resetOutput = () => {
    devices.current?.silence();
    piano.current.stop();
    scheduled.current.clear();
    played.current.clear();
  };
  const pause = () => {
    rememberPractice(practiceTime.current.stop(Date.now()));
    playRequest.current++;
    setLoadingAudio(false);
    freeSession.current.release(performance.now() / 1000);
    if (settingsRef.current.mode === "free") setFreePaused(true);
    engine.current.pause();
    resetOutput();
    refresh((v) => v + 1);
  };
  const reset = (s = song, config = settings) => {
    pause();
    freeSession.current.clear();
    setFreePaused(false);
    engine.current = new Trainer(s, config);
    activeMs.current = 0;
    lastClick.current = -999;
    setResult(null);
    refresh((v) => v + 1);
  };
  const displaySettings = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setLibrary((lib) => ({
      ...lib,
      settings: { ...lib.settings, [songId]: { ...settings, ...patch } },
    }));
  };
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "F11") {
        event.preventDefault();
        void fullscreen();
      }
      if (
        (event.code === "Space" || event.key === " ") &&
        !homeRef.current &&
        playback.current.enabled &&
        !(
          event.target instanceof Element &&
          event.target.closest("input,textarea,select,[contenteditable=true]")
        )
      ) {
        event.preventDefault();
        if (!event.repeat) playback.current.toggle();
      }
    };
    const changed = () => setFull(!!browserFullscreenElement());
    const failed = () => setNotice(fullscreenHelp);
    window.addEventListener("keydown", keyboard);
    document.addEventListener("fullscreenchange", changed);
    document.addEventListener("webkitfullscreenchange", changed);
    document.addEventListener("fullscreenerror", failed);
    document.addEventListener("webkitfullscreenerror", failed);
    changed();
    return () => {
      window.removeEventListener("keydown", keyboard);
      document.removeEventListener("fullscreenchange", changed);
      document.removeEventListener("webkitfullscreenchange", changed);
      document.removeEventListener("fullscreenerror", failed);
      document.removeEventListener("webkitfullscreenerror", failed);
    };
  }, []);
  async function fullscreen() {
    try {
      await toggleBrowserFullscreen();
    } catch {
      setNotice(fullscreenHelp);
    }
  }
  const configure = (patch: Partial<Settings>) => {
    if (patch.mode !== undefined) setLoopTool(false);
    const next = {
      ...settings,
      ...("from" in patch || "to" in patch ? { startBeat: undefined } : {}),
      ...patch,
    };
    next.from = Math.max(1, Math.min(song.measures.length, next.from));
    next.to = Math.max(next.from, Math.min(song.measures.length, next.to));
    reset(song, next);
    setSettings(next);
    setLibrary((lib) => ({
      ...lib,
      settings: { ...lib.settings, [songId]: next },
    }));
  };
  const choose = (s: Song) => {
    setLibrary((l) => ({
      ...l,
      songs: l.songs.some((item) => item.id === s.id)
        ? l.songs
        : [...l.songs, s],
    }));
    setHome(false);
    setLoopTool(false);
    const config = library.settings[s.id] ?? {
      ...defaults,
      to: s.measures.length,
      inputId: settings.inputId,
      outputId: settings.outputId,
    };
    reset(s, config);
    setSettings(config);
    setSongId(s.id);
    setLibrary((l) => ({ ...l, lastSong: s.id }));
    setPanel(null);
  };
  async function save(data: Library) {
    if (unsafeLoad.current) return;
    try {
      await saveBrowserLibrary(data);
      saveError.current = false;
    } catch (e) {
      saveError.current = true;
      setError("保存失败：" + String(e));
    }
  }
  function rememberPractice(span: PracticeSpan | undefined) {
    if (!span || !readyRef.current || unsafeLoad.current) return;
    if (
      spansRef.current.find((item) => item.id === span.id)?.endedAt ===
      span.endedAt
    )
      return;
    const next = [
      span,
      ...spansRef.current.filter((item) => item.id !== span.id),
    ];
    spansRef.current = next;
    setPracticeSpans(next);
  }
  async function savePractice() {
    if (!readyRef.current || unsafeLoad.current) return;
    try {
      await savePracticeSpans(spansRef.current);
    } catch (error) {
      setError("练琴记录保存失败：" + String(error));
    }
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [bundled, saved, spans] = await Promise.all([
          loadCatalogue(),
          loadBrowserLibrary(),
          loadPracticeSpans(),
        ]);
        if (cancelled) return;
        if (spans && !Array.isArray(spans)) throw Error("练琴记录格式无效");
        setPracticeSpans(spans ?? []);
        if (
          saved &&
          (saved.version !== 1 ||
            !Array.isArray(saved.songs) ||
            !Array.isArray(saved.results) ||
            !saved.settings)
        )
          throw Error("曲库格式无效");
        const replacing = !!saved && saved.collection !== "piano-scores-v2";
        if (replacing) await backupBrowserLibrary(saved!);
        const previous = saved;
        const byId = new Map(previous?.songs.map((s) => [s.id, s]) ?? []);
        const merged = bundled.map((s) => {
          const previous = byId.get(s.id);
          if (!previous) return s;
          const next = { ...s, tracks: previous.tracks };
          const fingers = new Map(previous.notes.map((n) => [n.id, n]));
          next.notes = s.notes.map((n) => {
            const saved = fingers.get(n.id);
            return saved?.midi === n.midi &&
              saved.beat === n.beat &&
              saved.duration === n.duration
              ? { ...n, finger: n.finger ?? saved.finger }
              : n;
          });
          if (s.warning?.startsWith("自动转谱")) {
            next.xml = makeXml(next);
          } else if (next.notes.some((n) => n.finger)) {
            return applyFingering(next, {
              fingers: Object.fromEntries(
                next.notes
                  .filter((n) => n.finger)
                  .map((n) => [n.id, n.finger!]),
              ),
              skipped: 0,
            });
          }
          return next;
        });
        const songs = [
          ...merged,
          ...(previous?.songs
            .filter(
              (s) =>
                (!replacing ||
                  s.source !== "builtin" ||
                  s.id.startsWith("daily-")) &&
                !merged.some((b) => b.id === s.id),
            )
            .map((s) =>
              s.source === "midi" ? { ...s, xml: makeXml(s) } : s,
            ) ?? []),
        ];
        const selected =
          songs.find((s) => s.id === previous?.lastSong) ?? songs[0];
        const config = previous?.settings[selected.id] ?? {
          ...defaults,
          to: selected.measures.length,
        };
        const data: Library = {
          version: 1,
          collection: "piano-scores-v2",
          songs,
          settings: previous?.settings ?? {},
          results: saved?.results ?? [],
          lastSong: selected.id,
          favorites: previous?.favorites ?? [],
        };
        setLibrary(data);
        setSongId(selected.id);
        setSettings(config);
        engine.current = new Trainer(selected, config);
      } catch (e) {
        if (!cancelled) {
          unsafeLoad.current = true;
          setError("曲库读取失败，为保护原文件已暂停保存。" + String(e));
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void save(library), 350);
    return () => clearTimeout(timer);
  }, [library, ready]);
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => void savePractice(), 350);
    return () => clearTimeout(timer);
  }, [practiceSpans, ready]);
  function receiveInput(data: Uint8Array | number[]) {
    if (homeRef.current || document.hidden) return;
    const [status, key, value] = data;
    const code = status & 0xf0;
    const mode = settingsRef.current.mode;
    if (
      mode !== "listen" &&
      (mode === "free" ? !freePausedRef.current : engine.current.running)
    ) {
      const now = Date.now();
      if (code === 0x90 && value > 0)
        rememberPractice(
          practiceTime.current.noteOn(
            key,
            {
              songId: songRef.current.id,
              title: songRef.current.title,
              mode,
            },
            now,
          ),
        );
      else if (code === 0x80 || code === 0x90)
        rememberPractice(practiceTime.current.noteOff(key, now));
    }
    if (settingsRef.current.mode === "free") {
      if (!freePausedRef.current)
        freeSession.current.input(data, performance.now() / 1000);
      return;
    }
    const e = engine.current;
    if (code === 0x90 && value > 0) e.down(key, value, performance.now());
    else if (code === 0x80 || code === 0x90) e.up(key, performance.now());
    else if (code === 0xb0 && key === 64) e.pedal = value;
    refresh((v) => v + 1);
  }
  useEffect(() => {
    const midi = new MidiDevices(
      () => devicesChanged((v) => v + 1),
      receiveInput,
      () => {
        pause();
        engine.current.pedal = 0;
        setNotice("钢琴连接已断开，练习已暂停。重新连接后可继续。");
      },
    );
    devices.current = midi;
    return () => {
      midi.dispose();
      devices.current = null;
    };
  }, []);
  useEffect(() => {
    const midi = devices.current;
    if (!midi?.access) return;
    const ins = midi.inputs(),
      outs = midi.outputs();
    if (
      !midi.input ||
      (settings.inputId &&
        midi.input.id !== settings.inputId &&
        ins.some((p) => p.id === settings.inputId))
    ) {
      const pick =
        ins.find((p) => p.id === settingsRef.current.inputId) ??
        ins.find((p) => /fp.?30|roland/i.test(p.name)) ??
        (ins.length === 1 ? ins[0] : null);
      if (pick) {
        midi.selectInput(pick.id);
        devicesChanged((v) => v + 1);
      }
    }
    if (settings.outputId === "none" && midi.output) midi.selectOutput("");
    if (
      (!midi.output ||
        (settings.outputId &&
          midi.output.id !== settings.outputId &&
          outs.some((p) => p.id === settings.outputId))) &&
      settingsRef.current.outputId !== "none"
    ) {
      const pick =
        outs.find((p) => p.id === settingsRef.current.outputId) ??
        outs.find((p) => /fp.?30|roland/i.test(p.name)) ??
        (outs.length === 1 ? outs[0] : null);
      if (pick) {
        midi.selectOutput(pick.id);
        devicesChanged((v) => v + 1);
      }
    }
  }, [
    devices.current?.access,
    devices.current
      ?.inputs()
      .map((p) => p.id)
      .join(),
    ready,
    settings.inputId,
    settings.outputId,
    devices.current
      ?.outputs()
      .map((p) => p.id)
      .join(),
  ]);
  useEffect(() => {
    const saveAndPause = () => {
      pause();
      if (readyRef.current) void save(libRef.current);
      void savePractice();
    };
    const visibility = () => {
      if (document.hidden) saveAndPause();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", saveAndPause);
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", saveAndPause);
    };
  }, []);
  const finish = () => {
    const e = engine.current;
    if (!e.settings.loop)
      rememberPractice(practiceTime.current.stop(Date.now()));
    resetOutput();
    if (e.settings.mode === "listen" || e.settings.mode === "free") {
      if (e.settings.mode === "listen" && e.settings.loop) {
        engine.current = new Trainer(e.song, e.settings);
        activeMs.current = 0;
        lastClick.current = -999;
        engine.current.startRun(performance.now(), false);
      }
      refresh((v) => v + 1);
      return;
    }
    const r: Result = {
      id: newId(),
      songId: e.song.id,
      title: e.song.title,
      date: new Date().toISOString(),
      seconds: Math.round(activeMs.current / 1000),
      ...e.stats,
      accuracy: e.accuracy,
      mode: e.settings.mode,
      speed: e.settings.speed,
      hand: e.settings.hand,
    };
    setLibrary((l) => ({ ...l, results: [r, ...l.results].slice(0, 1000) }));
    if (e.settings.loop) {
      engine.current = new Trainer(e.song, e.settings);
      activeMs.current = 0;
      played.current.clear();
      lastClick.current = -999;
      engine.current.startRun(performance.now());
    } else setResult(r);
  };
  const finishRef = useRef(finish);
  const reported = useRef<Trainer | null>(null);
  finishRef.current = finish;
  useEffect(() => {
    let frame = 0;
    let previousDraw = 0;
    function tick(now: number) {
      const e = engine.current;
      if (e.running) {
        if (lastFrame.current)
          activeMs.current += Math.min(100, now - lastFrame.current);
        e.update(now);
        const s = e.song,
          c = e.settings;
        const start = beatToSeconds(e.start, s.tempos),
          sec = beatToSeconds(e.beat, s.tempos);
        // Only notes on the chosen playback interval are emitted; accompaniment never echoes live input.
        const audible = audibleRef.current;
        for (const [id, n] of scheduled.current)
          if (now >= n.end) {
            scheduled.current.delete(id);
            if (
              ![...scheduled.current.values()].some(
                (other) => other.midi === n.midi,
              )
            )
              if (outputRoute.current === "browser") piano.current.off(n.midi);
              else devices.current?.off(n.midi);
          }
        if (sec >= start)
          for (const n of audible) {
            if (n.beat < e.start || n.beat >= e.end || played.current.has(n.id))
              continue;
            if (n.beat <= e.beat + 0.001) {
              played.current.add(n.id);
              if (n.beat + n.duration > e.beat) {
                if (outputRoute.current === "browser")
                  piano.current.on(n.midi, n.velocity);
                else devices.current?.on(n.midi, n.velocity);
                scheduled.current.set(n.id, {
                  midi: n.midi,
                  end:
                    now +
                    ((beatToSeconds(n.beat + n.duration, s.tempos) - sec) /
                      (c.speed / 100)) *
                      1000,
                });
              }
            }
          }
        const m = s.measures.findLast((m) => m.beat <= e.beat) ?? s.measures[0];
        const step = 4 / m.beatType;
        const click =
          Math.floor((e.beat - m.beat) / step + 1e-5) * step + m.beat;
        if (click !== lastClick.current && (c.metronome || e.beat < e.start)) {
          lastClick.current = click;
          const ctx = audio.current;
          if (ctx?.state === "running") {
            const osc = ctx.createOscillator(),
              gain = ctx.createGain();
            osc.frequency.value =
              Math.abs((click - m.beat) % m.length) < 0.01 ? 1100 : 750;
            gain.gain.setValueAtTime(0.05, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(
              0.001,
              ctx.currentTime + 0.05,
            );
            osc.connect(gain).connect(ctx.destination);
            osc.start();
            osc.stop(ctx.currentTime + 0.06);
          }
        }
      }
      if (e.done && reported.current !== e) {
        reported.current = e;
        finishRef.current();
      }
      lastFrame.current = now;
      if (now - lastPracticeCheckpoint.current >= 5000) {
        lastPracticeCheckpoint.current = now;
        rememberPractice(practiceTime.current.checkpoint(Date.now()));
      }
      if (!homeRef.current && e.running && now - previousDraw > 32) {
        refresh((v) => v + 1);
        previousDraw = now;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);
  function enableAudio() {
    const Context =
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context)
      throw Error("当前浏览器不支持声音播放，请使用 Chrome、Edge 或 Safari。");
    if (!audio.current) audio.current = new Context();
    return audio.current.resume();
  }
  async function connectMidi() {
    setNotice("");
    try {
      await Promise.all([devices.current!.connect(), enableAudio()]);
    } catch (e) {
      setNotice(String(e));
    }
  }
  async function start() {
    const config = settings;
    if (config.mode === "free") {
      if (freePaused) setFreePaused(false);
      else pause();
      return;
    }
    setError("");
    let e = engine.current;
    if (e.running) {
      pause();
      return;
    }
    if (config.mode !== "listen" && !e.notes.length) {
      setError("当前声部和区间没有练习音符，请修改声部分配或区间。");
      return;
    }
    if (e.done) {
      restart();
      e = engine.current;
    }
    const request = ++playRequest.current;
    setLoadingAudio(true);
    try {
      const notes = playbackNotes(e.song, e.settings);
      outputRoute.current = devices.current?.output ? "midi" : "browser";
      if (outputRoute.current === "browser" && notes.length) {
        await enableAudio();
        await piano.current.prepare(
          audio.current!,
          notes.map((n) => n.midi),
        );
      } else if (config.metronome || config.mode === "rhythm")
        await enableAudio();
      if (engine.current !== e || request !== playRequest.current) return;
      audibleRef.current = notes;
      if (activeMs.current === 0) startedAt.current = performance.now();
      lastFrame.current = performance.now();
      e.startRun(
        performance.now(),
        activeMs.current === 0 && config.mode !== "listen",
      );
      setNotice("");
      refresh((v) => v + 1);
    } catch (error) {
      if (request === playRequest.current)
        setError("播放未能开始：" + String(error));
    } finally {
      if (request === playRequest.current) setLoadingAudio(false);
    }
  }
  const restart = () =>
    configure({
      from: 1,
      to: song.measures.length,
      startBeat: undefined,
      loop: false,
    });
  playback.current = {
    enabled: ready && !busy && !loadingAudio && !preparingScore && !panel,
    toggle: () => void start(),
  };
  async function importFile(file: { name: string; bytes: number[] }) {
    setBusy(true);
    setError("");
    pause();
    try {
      const s = importScore(file.name, new Uint8Array(file.bytes));
      setPending({ song: s });
    } catch (e) {
      setError("导入失败：" + String(e));
    } finally {
      setBusy(false);
    }
  }
  function openImport() {
    document.getElementById("file-input")?.click();
  }
  async function commit() {
    if (!pending) return;
    setBusy(true);
    try {
      let s = { ...pending.song };
      s.notes = s.notes.map((n) => roleNote(n, s, settings.split));
      if (s.source === "midi") s.xml = makeXml(s);
      if (autoFingers) {
        const generated = await generateFingering(s, settings.split, handSize);
        s = generated.song;
        if (generated.skipped)
          setNotice(`${generated.skipped} 个音超出指法可分配范围，保留空白`);
      }
      const next = {
        ...libRef.current,
        songs: [...libRef.current.songs, s],
        lastSong: s.id,
      };
      await save(next);
      if (saveError.current) throw Error("曲库未能保存，请重试");
      setLibrary(next);
      setPending(null);
      choose(s);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function addFingers() {
    pause();
    setBusy(true);
    setFingerStatus("正在生成…");
    try {
      const generated = await generateFingering(song, settings.split, handSize);
      if (libRef.current.songs.find((s) => s.id === song.id) !== song)
        throw Error("曲谱已更改，请重新生成指法");
      const next = {
        ...libRef.current,
        songs: libRef.current.songs.map((s) =>
          s.id === song.id ? generated.song : s,
        ),
      };
      await save(next);
      if (saveError.current) throw Error("指法未能保存，请重试");
      setLibrary(next);
      if (songRef.current.id === song.id)
        reset(generated.song, settingsRef.current);
      setFingerStatus(
        generated.skipped
          ? `已生成；${generated.skipped} 个音超出可分配范围，保留空白`
          : "已生成并保存",
      );
    } catch (error) {
      setFingerStatus(String(error));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (
      freePlay ||
      home ||
      !ready ||
      busy ||
      !missingFingers ||
      fingerAttempts.current.has(song.id)
    )
      return;
    fingerAttempts.current.add(song.id);
    void addFingers();
  }, [freePlay, home, ready, busy, song]);
  const e = engine.current,
    m = song.measures.findLast((m) => m.beat <= e.beat);
  const currentTempo =
    song.tempos.findLast((t) => t.beat <= e.beat)?.bpm ??
    song.tempos[0]?.bpm ??
    100;
  const ins = devices.current?.inputs() ?? [],
    outs = devices.current?.outputs() ?? [];

  return (
    <div
      className={home ? "app web-app" : "app web-app practice-focus"}
      aria-busy={busy || loadingAudio}
    >
      {home && (
        <LibraryHome
          library={library}
          onChoose={choose}
          onFavorite={(s) =>
            setLibrary((l) => ({
              ...l,
              songs: l.songs.some((item) => item.id === s.id)
                ? l.songs
                : [...l.songs, s],
              favorites: (l.favorites ?? []).includes(s.id)
                ? l.favorites!.filter((x) => x !== s.id)
                : [...(l.favorites ?? []), s.id],
            }))
          }
          onImport={() => void openImport()}
          onDevice={() => {
            setSettingsTab("device");
            setPanel("settings");
          }}
          onHistory={() => setPanel("history")}
          onHelp={() => setPanel("help")}
          device={devices.current?.input?.name ?? ""}
          ready={ready}
        />
      )}
      <header hidden={home}>
        <button
          className="back-library"
          onClick={() => {
            pause();
            setHome(true);
            setPanel(null);
          }}
        >
          <Icon name="back" />
          曲库
        </button>
        <button
          className="song-button"
          onClick={() => setPanel(panel === "library" ? null : "library")}
          title="打开曲库"
        >
          <span className="song-name">{song.title}</span>
          <Icon name="chevron" />
        </button>
        <div className="toolbar">
          <select
            className="practice-mode"
            aria-label="练习模式"
            value={settings.mode}
            onChange={(event) =>
              configure({ mode: event.target.value as Settings["mode"] })
            }
          >
            <option value="wait">自由跟弹</option>
            <option value="free">自由练习</option>
            <option value="rhythm">节奏练习</option>
            <option value="listen">示范播放</option>
          </select>
          {freePlay ? (
            <button onClick={() => freeSession.current.clear()}>清空</button>
          ) : (
            <>
              <div className="tempo-tools">
                <label
                  className="toolbar-speed"
                  title={`拖动调节速度：${Math.round(currentTempo * 0.25)}–${Math.round(currentTempo * 1.5)} BPM；自由跟弹不限时间`}
                >
                  <input
                    aria-label="速度"
                    aria-valuetext={`${Math.round((currentTempo * settings.speed) / 100)} BPM`}
                    type="range"
                    min="25"
                    max="150"
                    step="1"
                    value={settings.speed}
                    onChange={(event) =>
                      configure({ speed: Number(event.target.value) })
                    }
                  />
                  <span className="tempo-bpm">
                    {Math.round((currentTempo * settings.speed) / 100)} BPM
                  </span>
                </label>
                <span className="tempo-reading" aria-label="当前节拍">
                  {m?.beats ?? 4}/{m?.beatType ?? 4}
                </span>
                <button
                  className={`icon-button metronome-button${settings.metronome ? " active" : ""}`}
                  aria-label="节拍器"
                  aria-pressed={settings.metronome}
                  title="节拍器"
                  onClick={() => configure({ metronome: !settings.metronome })}
                >
                  <Icon name="metronome" />
                </button>
              </div>
              <button onClick={restart} title="回到第一小节">
                <Icon name="restart" />
                重来
              </button>
              <button
                className={
                  loopTool || settings.loop
                    ? "loop-toggle active"
                    : "loop-toggle"
                }
                aria-label="重复工具"
                aria-pressed={loopTool || settings.loop}
                title="在曲谱上拖选小节"
                onClick={() => {
                  const enabled = !(loopTool || settings.loop);
                  setLoopTool(enabled);
                  if (!enabled) configure({ loop: false });
                }}
              >
                <Icon name="repeat" />
                {settings.loop ? `${settings.from}–${settings.to}` : "重复"}
              </button>
            </>
          )}
          <button onClick={() => void fullscreen()} title="全屏 / Esc 退出">
            <Icon name={full ? "collapse" : "expand"} />
            {full ? "退出全屏" : "全屏"}
          </button>
          <button
            className="primary playback-toggle"
            onClick={() => void start()}
            disabled={!ready || busy || loadingAudio || preparingScore}
            title="开始 / 暂停（空格）"
          >
            <Icon
              name={(freePlay ? !freePaused : e.running) ? "pause" : "play"}
            />
            {(freePlay ? !freePaused : e.running)
              ? "暂停"
              : freePlay
                ? "继续"
                : settings.mode === "listen"
                  ? "播放"
                  : "开始"}
          </button>
          <button
            className="icon-button"
            title="更多设置"
            onClick={() => {
              setPanel(panel === "settings" ? null : "settings");
            }}
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {error && (
        <div role="alert" className="banner error">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      {notice && panel !== "settings" && (
        <div className="banner">
          {notice}
          <button onClick={() => setNotice("")}>关闭</button>
        </div>
      )}
      {!home && (
        <main>
          <section
            className="sheet"
            style={{ height: `${settings.sheetHeight}%` }}
            aria-busy={preparingScore}
          >
            {preparingScore ? (
              <div className="sheet-loading" role="status">
                正在准备曲谱…
              </div>
            ) : (
              <Sheet
                xml={song.xml}
                beat={Math.max(e.start, e.beat)}
                trainer={e}
                loopTool={freePlay ? false : loopTool}
                onLoop={([from, to]) => {
                  const running = engine.current.running;
                  configure({ from, to, loop: true });
                  if (running)
                    engine.current.startRun(performance.now(), false);
                  setLoopTool(false);
                }}
                onSeek={(beat) =>
                  configure({
                    from:
                      (song.measures.findLast((m) => m.beat <= beat)?.index ??
                        0) + 1,
                    to: Math.max(
                      settings.to,
                      (song.measures.findLast((m) => m.beat <= beat)?.index ??
                        0) + 1,
                    ),
                    startBeat: beat,
                  })
                }
              />
            )}
          </section>
          <input
            className="resize"
            aria-label="曲谱区域高度"
            type="range"
            min="22"
            max="48"
            value={settings.sheetHeight}
            onChange={(v) => {
              displaySettings({ sheetHeight: Number(v.target.value) });
            }}
          />
          {freePlay ? (
            <FreePlay
              session={freeSession.current}
              pitches={keyboardPitches}
              onInput={receiveInput}
              paused={freePaused}
              minWhiteKeys={settings.minWhiteKeys}
              split={settings.split}
              registerMode={settings.registerMode}
            />
          ) : (
            <Roll
              song={song}
              settings={settings}
              trainer={e}
              pitches={keyboardPitches}
              onInput={receiveInput}
            />
          )}
        </main>
      )}
      {panel && (
        <>
          <div
            className={panel === "settings" ? "scrim settings-scrim" : "scrim"}
            onClick={() => setPanel(null)}
          />
          <aside
            className={panel === "settings" ? "settings-panel" : undefined}
          >
            <div className="panel-heading">
              <h2>
                {
                  {
                    library: "曲库",
                    settings: "练习设置",
                    history: "练习记录",
                    help: "使用帮助",
                  }[panel]
                }
              </h2>
              <button onClick={() => setPanel(null)}>
                <Icon name="close" />
              </button>
            </div>
            {panel === "library" && (
              <>
                <button
                  className="primary wide"
                  disabled={busy}
                  onClick={() => void openImport()}
                >
                  {busy ? "正在解析…" : "导入曲谱"}
                </button>
                <p className="muted">MIDI · MusicXML · MXL</p>
                <div className="song-list">
                  {library.songs.map((s) => (
                    <div
                      className={`song-row ${s.id === songId ? "active" : ""}`}
                      key={s.id}
                    >
                      <button onClick={() => choose(s)}>
                        <strong>{s.title}</strong>
                        <small>
                          {s.difficulty || "自选曲目"} · {s.measures.length}{" "}
                          小节
                        </small>
                      </button>
                      {s.source !== "builtin" && (
                        <button
                          title="从曲库删除"
                          onClick={() => {
                            if (
                              confirm(`从曲库移除“${s.title}”？练习记录保留。`)
                            ) {
                              const next = library.songs.filter(
                                (x) => x.id !== s.id,
                              );
                              setLibrary((l) => ({ ...l, songs: next }));
                              if (s.id === songId) choose(next[0]);
                            }
                          }}
                        >
                          <Icon name="close" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="muted">{song.sourceInfo}</p>
                {song.warning && <p className="hint">{song.warning}</p>}
              </>
            )}
            {panel === "settings" && (
              <>
                <div
                  className="settings-tabs"
                  role="tablist"
                  aria-label="设置分类"
                >
                  {(
                    [
                      ["practice", "练习"],
                      ["device", "设备"],
                      ["display", "显示"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      role="tab"
                      aria-selected={settingsTab === id}
                      aria-controls={`settings-${id}`}
                      id={`tab-${id}`}
                      onClick={() => setSettingsTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="settings-pages">
                  <div
                    role="tabpanel"
                    id="settings-practice"
                    aria-labelledby="tab-practice"
                    hidden={settingsTab !== "practice"}
                  >
                    <section className="settings-group">
                      <div className="settings-basics">
                        <label
                          className="field"
                          hidden={freePlay || settings.mode === "listen"}
                        >
                          声部
                          <select
                            aria-label="练习双手"
                            value={settings.hand}
                            onChange={(v) =>
                              configure({
                                hand: v.target.value as Settings["hand"],
                              })
                            }
                          >
                            <option value="both">双手</option>
                            <option value="right">右手</option>
                            <option value="left">左手</option>
                          </select>
                        </label>
                      </div>
                      <label className="toggle-row" hidden={freePlay}>
                        循环练习
                        <input
                          type="checkbox"
                          checked={settings.loop}
                          onChange={(v) =>
                            configure({ loop: v.target.checked })
                          }
                        />
                      </label>
                      <div className="loop-range" hidden={freePlay}>
                        <label>
                          起始小节
                          <input
                            aria-label="起始小节"
                            type="number"
                            min="1"
                            max={song.measures.length}
                            value={settings.from}
                            onChange={(v) =>
                              configure({ from: Number(v.target.value) || 1 })
                            }
                          />
                        </label>
                        <span>—</span>
                        <label>
                          结束小节
                          <input
                            aria-label="结束小节"
                            type="number"
                            min={settings.from}
                            max={song.measures.length}
                            value={settings.to}
                            onChange={(v) =>
                              configure({
                                to: Number(v.target.value) || settings.from,
                              })
                            }
                          />
                        </label>
                      </div>
                    </section>
                    <details className="settings-advanced">
                      <summary>自动指法</summary>
                      <label className="field">
                        手掌大小
                        <select
                          aria-label="手掌大小"
                          value={handSize}
                          onChange={(e) =>
                            setHandSize(e.target.value as HandSize)
                          }
                          disabled={busy}
                        >
                          <option value="S">较小</option>
                          <option value="M">中等</option>
                          <option value="L">较大</option>
                        </select>
                      </label>
                      <button disabled={busy} onClick={() => void addFingers()}>
                        {busy ? "正在生成…" : "生成缺失指法"}
                      </button>
                      <p className="hint" role="status">
                        {fingerStatus ||
                          "本地生成建议指法，保留已有标注。请先确认左右手声部。"}
                      </p>
                    </details>
                  </div>
                  <div
                    role="tabpanel"
                    id="settings-device"
                    aria-labelledby="tab-device"
                    hidden={settingsTab !== "device"}
                  >
                    <section className="settings-group">
                      <div className="device-status">
                        <span
                          className={
                            devices.current?.input
                              ? "device-status-icon connected"
                              : "device-status-icon"
                          }
                        >
                          <Icon name="piano" />
                        </span>
                        <div>
                          <strong>
                            {devices.current?.input?.name || "尚未连接钢琴"}
                          </strong>
                          <small>
                            力度 {e.lastVelocity || "—"} · 踏板{" "}
                            {e.pedal >= 64 ? "按下" : "松开"}
                          </small>
                        </div>
                        <button
                          aria-label="连接钢琴"
                          onClick={() => void connectMidi()}
                        >
                          {devices.current?.access ? "刷新" : "连接"}
                        </button>
                      </div>
                      <label className="field device-field">
                        输入
                        <select
                          aria-label="MIDI 输入"
                          value={devices.current?.input?.id ?? ""}
                          onChange={(v) => {
                            pause();
                            devices.current?.selectInput(v.target.value);
                            configure({ inputId: v.target.value });
                          }}
                        >
                          <option value="">请选择输入设备</option>
                          {ins.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field device-field">
                        输出
                        <select
                          aria-label="MIDI 输出"
                          value={devices.current?.output?.id ?? ""}
                          onChange={(v) => {
                            devices.current?.selectOutput(v.target.value);
                            configure({ outputId: v.target.value || "none" });
                          }}
                        >
                          <option value="">电脑扬声器</option>
                          {outs.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      {notice && <p className="hint">{notice}</p>}
                      <label className="field check">
                        <input
                          type="checkbox"
                          checked={
                            settings.mode === "rhythm" && settings.backing
                          }
                          disabled={settings.mode !== "rhythm"}
                          onChange={(v) =>
                            configure({ backing: v.target.checked })
                          }
                        />
                        节奏模式伴奏
                      </label>
                    </section>
                  </div>
                  <div
                    role="tabpanel"
                    id="settings-display"
                    aria-labelledby="tab-display"
                    hidden={settingsTab !== "display"}
                  >
                    <section className="settings-group">
                      <label className="field">
                        键盘音区
                        <select
                          aria-label="键盘音区"
                          value={settings.registerMode ?? "follow"}
                          onChange={(v) =>
                            displaySettings({
                              registerMode: v.target
                                .value as Settings["registerMode"],
                            })
                          }
                        >
                          <option value="follow">跟随乐句</option>
                          <option value="lock">锁定当前音区</option>
                          <option value="full">完整键盘</option>
                        </select>
                      </label>
                      <label className="field">
                        最少显示白键数
                        <input
                          aria-label="最少显示白键数"
                          type="number"
                          min="7"
                          max="52"
                          step="1"
                          defaultValue={
                            settings.minWhiteKeys ?? DEFAULT_MIN_WHITE_KEYS
                          }
                          onBlur={(event) => {
                            const count = Math.max(
                              7,
                              Math.min(
                                52,
                                Math.round(
                                  Number(event.target.value) ||
                                    DEFAULT_MIN_WHITE_KEYS,
                                ),
                              ),
                            );
                            event.target.value = String(count);
                            displaySettings({ minWhiteKeys: count });
                          }}
                        />
                      </label>
                    </section>
                    <details className="settings-advanced">
                      <summary>声部分配</summary>
                      {song.tracks.map((t) => (
                        <label className="field track" key={t.id}>
                          <span>
                            {t.name}
                            <small>
                              {t.count} 音 · {pitchName(t.low)}–
                              {pitchName(t.high)}
                            </small>
                          </span>
                          <select
                            value={t.role}
                            onChange={(v) => {
                              const next = {
                                ...song,
                                tracks: song.tracks.map((x) =>
                                  x.id === t.id
                                    ? { ...x, role: v.target.value as Role }
                                    : x,
                                ),
                              };
                              next.notes = next.notes.map((n) =>
                                roleNote(n, next, settings.split),
                              );
                              if (next.source === "midi")
                                next.xml = makeXml(next);
                              reset(next, settings);
                              setLibrary((l) => ({
                                ...l,
                                songs: l.songs.map((x) =>
                                  x.id === next.id ? next : x,
                                ),
                              }));
                            }}
                          >
                            {roleOptions()}
                          </select>
                        </label>
                      ))}
                      <label className="field">
                        分手分界（低于此音为左手）
                        <select
                          value={settings.split}
                          onChange={(v) => {
                            const split = Number(v.target.value);
                            const next = {
                              ...song,
                              notes: song.notes.map((n) =>
                                roleNote(n, song, split),
                              ),
                            };
                            if (next.source === "midi")
                              next.xml = makeXml(next);
                            setLibrary((l) => ({
                              ...l,
                              songs: l.songs.map((x) =>
                                x.id === song.id ? next : x,
                              ),
                            }));
                            configure({ split });
                          }}
                        >
                          {[48, 55, 60, 64, 67, 72].map((n) => (
                            <option key={n} value={n}>
                              {pitchName(n)}
                            </option>
                          ))}
                        </select>
                      </label>
                      {song.warning && <p className="hint">{song.warning}</p>}
                    </details>
                  </div>
                </div>
              </>
            )}
            {panel === "history" && (
              <>
                <section aria-label="练琴时长">
                  <div className="practice-totals">
                    <div>
                      <small>今日</small>
                      <strong>
                        {practiceDuration(
                          practiceSummary.byDay[
                            new Date().toLocaleDateString("sv-SE")
                          ] ?? 0,
                        )}
                      </strong>
                    </div>
                    <div>
                      <small>累计</small>
                      <strong>
                        {practiceDuration(practiceSummary.totalMs)}
                      </strong>
                    </div>
                  </div>
                  {practiceSpans.length === 0 ? (
                    <p className="muted">弹奏后会显示时长和时间段。</p>
                  ) : (
                    practiceSpans.map((span) => (
                      <div
                        className="history-row practice-time-row"
                        key={span.id}
                      >
                        <strong>
                          {span.title}
                          <b>{practiceDuration(span.durationMs)}</b>
                        </strong>
                        <small>
                          {practiceDate.format(span.startedAt)} —{" "}
                          {practiceDate.format(span.endedAt)}
                        </small>
                        <small>
                          {
                            {
                              wait: "自由跟弹",
                              free: "自由练习",
                              rhythm: "节奏练习",
                            }[span.mode]
                          }
                        </small>
                      </div>
                    ))
                  )}
                </section>
                <details className="practice-results">
                  <summary>练习成绩</summary>
                  {library.results.length === 0 ? (
                    <p className="muted">完成一次练习后会显示记录。</p>
                  ) : (
                    library.results.map((r) => (
                      <div className="history-row" key={r.id}>
                        <strong>
                          {r.title}
                          <b>{r.accuracy}%</b>
                        </strong>
                        <small>
                          {new Date(r.date).toLocaleString("zh-CN")} ·{" "}
                          {r.mode === "wait"
                            ? "自由跟弹"
                            : `节奏 · ${Math.round(r.speed)}%`}
                        </small>
                        <p>
                          正确 {r.correct}　错音 {r.wrong}　漏音 {r.missed}　
                          {r.seconds} 秒
                        </p>
                        {r.problemMeasures.length > 0 && (
                          <small>
                            问题小节：{r.problemMeasures.join("、")}
                          </small>
                        )}
                      </div>
                    ))
                  )}
                </details>
              </>
            )}
            {panel === "help" && (
              <div className="help">
                <h3>开始练习</h3>
                <p>
                  打开钢琴电源，USB-B 插 USB Computer，USB-C 插电脑或
                  iPad。在设备设置中点击连接，选择 FP-30X。
                </p>
                <p>
                  自由跟弹按自己的速度练习，弹对一组音即可继续，不用等待节拍。可以选双手，或先分手熟悉两三个小节。
                </p>
                <p>
                  顶栏可切换自由跟弹、自由练习、节奏练习和示范播放。自由练习记录上升音符，节奏练习按拍判定，示范播放自动演奏曲子。空格控制当前模式的开始或暂停。
                </p>
                <h3>导入喜欢的曲子</h3>
                <p>
                  优先获取有授权的 MusicXML / MXL，它们能保留五线谱。MIDI
                  也能导入，但自动转谱只是练习参考。
                </p>
                <p>
                  可以在 MuseScore Studio 中手工录谱或打开合法获得的谱，再导出
                  MusicXML。公版原作的现代编配和排版可能仍有版权，请查看具体授权。
                </p>
                <h3>发声与连接</h3>
                <p>
                  软件不回放你弹的音，直接听钢琴；示范与伴奏优先通过所选 MIDI
                  发给钢琴，没有选择输出设备时由浏览器播放。节拍器由浏览器输出。钢琴移调设为
                  0，关闭叠音/分键，避免重复输入。
                </p>
                <h3>数据与限制</h3>
                <p>
                  练习记录中可查看今日与累计时长、每次弹奏的起止时间。从实际按键开始计时，30秒无输入分段；示范、暂停和后台不计入。时段只保存在当前浏览器。
                </p>
                <p>
                  曲库和练习记录保存在当前浏览器。支持离线缓存的浏览器，首次缓存完成后可离线使用；清理网站数据会删除本机记录。曲谱反复与跳转按提示处理，不自动展开。
                </p>
                <p>手型与指法需另行学习，本软件仅判断音高和起音时机。</p>
                <h3>开源来源</h3>
                <p>
                  Bach to Basics（MIT）MIDI
                  解析逻辑的改写；React、OpenSheetMusicDisplay 等许可证见源码
                  NOTICE.md 和 LICENSES.third-party.txt。
                </p>
                <p>
                  钢琴音色：Alexander Holm 的 Salamander Grand Piano（CC BY
                  3.0），
                  <a
                    href="./licenses/Salamander-ATTRIBUTION.txt"
                    target="_blank"
                    rel="noreferrer"
                  >
                    来源与授权
                  </a>
                  。
                </p>
              </div>
            )}
          </aside>
        </>
      )}
      {pending && (
        <div className="modal-backdrop">
          <div className="modal">
            <h2>分配练习声部</h2>
            <p>
              {pending.song.title} · {pending.song.notes.length} 音 ·{" "}
              {pending.song.measures.length} 小节
            </p>
            {pending.song.tracks.map((t) => (
              <label className="field track" key={t.id}>
                <span>
                  {t.name}
                  <small>
                    {t.count} 音 · {pitchName(t.low)}–{pitchName(t.high)}
                  </small>
                </span>
                <select
                  value={t.role}
                  onChange={(v) =>
                    setPending({
                      ...pending,
                      song: {
                        ...pending.song,
                        tracks: pending.song.tracks.map((x) =>
                          x.id === t.id
                            ? { ...x, role: v.target.value as Role }
                            : x,
                        ),
                      },
                    })
                  }
                >
                  {roleOptions()}
                </select>
              </label>
            ))}
            <p className="hint">
              {pending.song.warning ||
                "确认左右手后加入曲库；之后仍可在设置中修改。"}
            </p>
            <label className="field check">
              <input
                type="checkbox"
                checked={autoFingers}
                disabled={busy}
                onChange={(e) => setAutoFingers(e.target.checked)}
              />
              自动生成缺失指法
            </label>
            {error && <p className="hint">{error}</p>}
            <div className="actions">
              <button disabled={busy} onClick={() => setPending(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  pending.song.tracks.every((t) =>
                    ["ignore", "backing"].includes(t.role),
                  )
                }
                onClick={() => void commit()}
              >
                {busy ? "保存中…" : "加入曲库"}
              </button>
            </div>
          </div>
        </div>
      )}
      {result && (
        <div className="modal-backdrop">
          <div className="modal result">
            <span className="eyebrow">本次练习</span>
            <h2>{result.title}</h2>
            <div className="result-score">
              {result.accuracy}
              <small>% 准确率</small>
            </div>
            <p>
              正确 {result.correct}　错音 {result.wrong}　漏音 {result.missed}
            </p>
            {result.offsets.length > 0 && (
              <p className="muted">
                平均起音：
                {Math.round(
                  result.offsets.reduce((s, v) => s + v, 0) /
                    result.offsets.length,
                )}{" "}
                毫秒（负数提前，正数滞后）
              </p>
            )}
            <p className="muted">
              {result.problemMeasures.length
                ? `问题小节：${result.problemMeasures.join("、")}`
                : "本次没有记录到问题小节"}
            </p>
            <div className="actions">
              <button onClick={() => setResult(null)}>完成</button>
              {result.problemMeasures.length > 0 && (
                <button
                  onClick={() => {
                    configure({
                      from: Math.min(...result.problemMeasures),
                      to: Math.max(...result.problemMeasures),
                      loop: true,
                    });
                  }}
                >
                  重练问题区间
                </button>
              )}
              <button className="primary" onClick={() => reset()}>
                再练一次
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        id="file-input"
        type="file"
        hidden
        accept=".mid,.midi,.xml,.musicxml,.mxl"
        onChange={async (v) => {
          const file = v.target.files?.[0];
          if (file)
            await importFile({
              name: file.name,
              bytes: Array.from(new Uint8Array(await file.arrayBuffer())),
            });
          v.target.value = "";
        }}
      />
    </div>
  );
}
function roleOptions() {
  return (
    <>
      <option value="right">右手</option>
      <option value="left">左手</option>
      <option value="split">按音高分手</option>
      <option value="staff">按原谱分手</option>
      <option value="backing">伴奏</option>
      <option value="ignore">忽略</option>
    </>
  );
}
