const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const artifacts = path.resolve(__dirname, "../test-results");
const title = "播放回归测试";
const pitches = ["C", "D", "E", "F"];
// An original eight-second score: both hands start together in every bar.
const score = `<score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${pitches
  .map(
    (step, i) =>
      `<measure number="${i + 1}">${
        i === 0
          ? '<attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>'
          : ""
      }<note><pitch><step>${step}</step><octave>5</octave></pitch><duration>4</duration><voice>1</voice><type>whole</type><staff>1</staff><notations><technical><fingering>1</fingering></technical></notations></note><backup><duration>4</duration></backup><note><pitch><step>${step}</step><octave>3</octave></pitch><duration>4</duration><voice>2</voice><type>whole</type><staff>2</staff><notations><technical><fingering>5</fingering></technical></notations></note></measure>`,
  )
  .join("")}</part></score-partwise>`;

// Instrument real browser audio; fetch, MP3 decoding, source nodes and audio
// output remain native. The analyser observes PCM on the actual output path.
function installProbe({ midi, holdSamples }) {
  const pending = [];
  const bytesUrl = new WeakMap();
  const bufferUrl = new WeakMap();
  const analysers = new Map();
  const active = new Set();
  const state = {
    starts: [],
    stops: 0,
    decoded: [],
    waiting: 0,
    maxRms: 0,
    maxPeak: 0,
    nonzeroFrames: 0,
    held: holdSamples,
    sent: [],
    midiRequests: 0,
    labelPairs: [],
  };
  // Observe the real canvas positions used when Pixi rasterizes its two-row
  // labels. Centering the text block alone does not center "1" above "C3".
  const previousLabel = new WeakMap();
  for (const prototype of [
    window.CanvasRenderingContext2D?.prototype,
    window.OffscreenCanvasRenderingContext2D?.prototype,
  ].filter(Boolean)) {
    const fillText = prototype.fillText;
    prototype.fillText = function (text, x, y, ...args) {
      if (/sans-serif/.test(this.font)) {
        const width = this.measureText(text).width;
        const center =
          x +
          (this.textAlign === "center"
            ? 0
            : ["right", "end"].includes(this.textAlign)
              ? -width / 2
              : width / 2);
        const previous = previousLabel.get(this);
        if (
          /^C[0-8]$/.test(text) &&
          previous?.text === "1" &&
          previous.font === this.font &&
          y > previous.y &&
          state.labelPairs.length < 50
        ) {
          state.labelPairs.push({
            note: text,
            numberCenter: previous.center,
            nameCenter: center,
          });
        }
        previousLabel.set(this, { text, center, y, font: this.font });
      }
      return fillText.call(this, text, x, y, ...args);
    };
  }
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const url = new URL(
      typeof args[0] === "string" ? args[0] : args[0].url,
      location.href,
    ).href;
    const sample = /\/audio\/piano\/[^/]+\.mp3(?:\?|$)/.test(url);
    if (sample && state.held) {
      state.waiting++;
      await new Promise((resolve) => pending.push(resolve));
    }
    const response = await nativeFetch(...args);
    if (sample) {
      const arrayBuffer = response.arrayBuffer.bind(response);
      response.arrayBuffer = async () => {
        const bytes = await arrayBuffer();
        bytesUrl.set(bytes, url);
        return bytes;
      };
    }
    return response;
  };
  const NativeContext = window.AudioContext || window.webkitAudioContext;
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (destination, ...args) {
    const analyser = analysers.get(this.context);
    return connect.call(
      this,
      analyser && destination === this.context.destination
        ? analyser
        : destination,
      ...args,
    );
  };
  class ProbedContext extends NativeContext {
    constructor(...args) {
      super(...args);
      const analyser = this.createAnalyser();
      analyser.fftSize = 2048;
      connect.call(analyser, this.destination);
      analysers.set(this, analyser);
      const decode = this.decodeAudioData.bind(this);
      this.decodeAudioData = async (bytes, ...callbacks) => {
        const url = bytesUrl.get(bytes);
        const buffer = await decode(bytes, ...callbacks);
        bufferUrl.set(buffer, url);
        const samples = buffer.getChannelData(0);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
        state.decoded.push({ url, peak, duration: buffer.duration });
        return buffer;
      };
      const createSource = this.createBufferSource.bind(this);
      this.createBufferSource = () => {
        const source = createSource();
        const start = source.start.bind(source);
        const stop = source.stop.bind(source);
        source.start = (...parameters) => {
          state.starts.push({
            url: bufferUrl.get(source.buffer),
            rate: source.playbackRate.value,
            duration: source.buffer?.duration,
          });
          active.add(source);
          return start(...parameters);
        };
        source.stop = (...parameters) => {
          state.stops++;
          return stop(...parameters);
        };
        source.addEventListener("ended", () => active.delete(source));
        return source;
      };
    }
  }
  window.AudioContext = ProbedContext;
  if (window.webkitAudioContext) window.webkitAudioContext = ProbedContext;
  setInterval(() => {
    for (const [context, analyser] of analysers) {
      if (context.state !== "running") continue;
      const pcm = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(pcm);
      let energy = 0;
      let peak = 0;
      for (const sample of pcm) {
        energy += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
      const rms = Math.sqrt(energy / pcm.length);
      state.maxRms = Math.max(state.maxRms, rms);
      state.maxPeak = Math.max(state.maxPeak, peak);
      if (rms > 0.00001) state.nonzeroFrames++;
    }
  }, 20);
  window.playbackProbe = {
    state,
    snapshot: () => ({
      ...state,
      active: active.size,
      contexts: [...analysers.keys()].map((context) => context.state),
    }),
    resetSignal: () => {
      state.maxRms = 0;
      state.maxPeak = 0;
      state.nonzeroFrames = 0;
    },
    releaseSamples: () => {
      state.held = false;
      for (const release of pending.splice(0)) release();
    },
  };
  const input = {
    id: "playback-in",
    name: "QA FP-30X",
    type: "input",
    state: "connected",
    onmidimessage: null,
  };
  const output = {
    id: "playback-out",
    name: "QA FP-30X",
    type: "output",
    state: "connected",
    send: (data) => state.sent.push([...data]),
  };
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: midi
      ? async () => {
          state.midiRequests++;
          return {
            inputs: new Map([[input.id, input]]),
            outputs: new Map([[output.id, output]]),
            onstatechange: null,
          };
        }
      : undefined,
  });
}

const snapshot = (page) => page.evaluate(() => playbackProbe.snapshot());
const playhead = (page) =>
  page.locator(".score-playhead").evaluate((el) => parseFloat(el.style.left));
async function readyScore(page) {
  await page.locator(".sheet-host svg").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".app")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector(".sheet-loading"),
  );
  await page
    .locator("header")
    .getByLabel("练习模式", { exact: true })
    .waitFor();
  await page.locator("header .primary").waitFor();
}
async function importFixture(page) {
  await page.goto(base);
  await page.locator(".music-card").first().waitFor();
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.getByRole("button", { name: "导入曲谱", exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: `${title}.musicxml`,
    mimeType: "application/xml",
    buffer: Buffer.from(score),
  });
  await page.getByLabel("自动生成缺失指法", { exact: true }).uncheck();
  await page.getByRole("button", { name: "加入曲库", exact: true }).click();
  await readyScore(page);
}
async function settings(page, tab = "练习") {
  await page.getByTitle("更多设置", { exact: true }).click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
const closeSettings = (page) => page.locator(".panel-heading button").click();
async function selectMode(page, mode) {
  await page
    .locator("header")
    .getByLabel("练习模式", { exact: true })
    .selectOption(mode);
  await page
    .getByLabel("练习模式", { exact: true })
    .evaluate((el) => el.blur());
}
async function assertAdvances(page, from) {
  await page.waitForFunction(
    (initial) =>
      parseFloat(document.querySelector(".score-playhead").style.left) >
      initial + 1,
    from,
    { timeout: 5000 },
  );
}
async function assertVisuals(page) {
  await page.waitForFunction(() => playbackProbe.state.labelPairs.length > 0);
  const pairs = (await snapshot(page)).labelPairs;
  assert(
    pairs.every(
      (pair) => Math.abs(pair.numberCenter - pair.nameCenter) <= 0.75,
    ),
    `唱名与音名没有逐行居中：${JSON.stringify(pairs)}`,
  );
  const primary = page.locator("header .primary");
  await primary.hover();
  await page.waitForTimeout(200);
  const colors = await primary.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, foreground: style.color };
  });
  const luminance = (color) => {
    const channels = color
      .match(/[\d.]+/g)
      .slice(0, 3)
      .map((part) => {
        const value = Number(part) / 255;
        return value <= 0.04045
          ? value / 12.92
          : ((value + 0.055) / 1.055) ** 2.4;
      });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  const background = luminance(colors.background);
  const foreground = luminance(colors.foreground);
  const contrast =
    (Math.max(background, foreground) + 0.05) /
    (Math.min(background, foreground) + 0.05);
  assert(
    background > 0.35 && contrast >= 4.5,
    `主按钮悬停后变暗或文字不可读：${JSON.stringify({ ...colors, contrast })}`,
  );
  await page.mouse.move(1, 1);
  return { centeredLabels: pairs.length, hoverContrast: contrast };
}
async function assertAudible(page) {
  await page.waitForFunction(
    () => playbackProbe.state.nonzeroFrames >= 3,
    undefined,
    { timeout: 15000 },
  );
  const audio = await snapshot(page);
  assert(
    audio.maxRms > 0.00001,
    `真实输出 PCM 无声音：${JSON.stringify(audio)}`,
  );
  assert(audio.decoded.some((sample) => sample.peak > 0.01));
  assert(audio.starts.every((source) => source.duration > 0));
  return audio;
}
async function assertQuiet(page) {
  await page.waitForTimeout(350); // Native note release is 150 ms plus FFT tail.
  await page.evaluate(() => playbackProbe.resetSignal());
  const stoppedAt = await snapshot(page);
  await page.waitForTimeout(450);
  const quiet = await snapshot(page);
  assert.equal(quiet.active, 0, "暂停/取消后仍有采样声源");
  assert.equal(
    quiet.starts.length,
    stoppedAt.starts.length,
    "停止后又启动声源",
  );
  assert(quiet.maxRms < 0.00001, `停止后仍有输出：${quiet.maxRms}`);
  return quiet;
}
async function keyboardPixels(page, name, contact = false) {
  const clip = await page
    .locator(".roll-keyboard")
    .evaluate((host, contact) => {
      const outer = host.getBoundingClientRect();
      const keys = host.querySelector(".upstream-keys").getBoundingClientRect();
      const x = Math.max(0, outer.left);
      const y = Math.max(
        0,
        contact ? Math.max(outer.top, keys.top - 90) : keys.top,
      );
      return {
        x,
        y,
        width: Math.min(innerWidth, outer.right) - x,
        height: contact ? keys.top - y : Math.min(innerHeight, keys.bottom) - y,
      };
    }, contact);
  // Decode the browser's actual composited screenshot. Reading a WebGL canvas
  // after its buffer has been presented can otherwise return empty pixels.
  const png = await page.screenshot({ clip, scale: "css" });
  await fs.writeFile(path.join(artifacts, `${name}.png`), png);
  return page.evaluate(
    async ({ bytes, contact }) => {
      const image = await createImageBitmap(
        new Blob([new Uint8Array(bytes)], { type: "image/png" }),
      );
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      image.close();
      const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
      let green = 0,
        purple = 0,
        contactColors = 0,
        upperDark = 0,
        upperTotal = 0,
        lowerDark = 0,
        lowerTotal = 0;
      for (let y = 0; y < canvas.height; y++) {
        const fraction = y / canvas.height;
        for (let x = 0; x < canvas.width; x++) {
          const offset = (y * canvas.width + x) * 4;
          const [r, g, b] = data.subarray(offset, offset + 3);
          // Amber, pink and blue fragments are distinct from either hand's
          // green/purple bars, their gradients and the neutral beat lines.
          if (
            contact &&
            ((r > g + 20 && r > b + 20) ||
              (r > g + 25 && b > g + 15) ||
              (b > r + 25 && g > r + 20 && b > g + 15))
          )
            contactColors++;
          if (fraction > 0.63) {
            if (g > r + 30 && g > b + 20) green++;
            if (b > r + 25 && b > g + 40 && r > g + 8) purple++;
          }
          const dark = r < 80 && g < 80 && b < 90;
          if (fraction > 0.12 && fraction < 0.5) {
            upperTotal++;
            if (dark) upperDark++;
          }
          // Below the black keys, above most labels: the same dark region must
          // not extend down over the white keys when their highlights are drawn.
          if (fraction > 0.63 && fraction < 0.72) {
            lowerTotal++;
            if (dark) lowerDark++;
          }
        }
      }
      return {
        green,
        purple,
        contactColors,
        upperDarkRatio: upperDark / upperTotal,
        lowerDarkRatio: lowerDark / lowerTotal,
      };
    },
    { bytes: [...png], contact },
  );
}
function assertLitKeyboard(pixels) {
  assert(pixels.green > 100, `右手键未亮绿：${JSON.stringify(pixels)}`);
  assert(pixels.purple > 100, `左手键未亮紫：${JSON.stringify(pixels)}`);
  assert(
    pixels.upperDarkRatio > 0.1 && pixels.lowerDarkRatio < 0.1,
    `亮键后黑白键仍须可辨：${JSON.stringify(pixels)}`,
  );
}
async function mainScenario(page, context) {
  await importFixture(page);
  const mode = page.locator("header").getByLabel("练习模式", { exact: true });
  assert.equal(await page.getByLabel("练习模式", { exact: true }).count(), 1);
  assert.deepEqual(
    await mode
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => [option.value, option.textContent]),
      ),
    [
      ["wait", "自由跟弹"],
      ["free", "自由练习"],
      ["rhythm", "节奏练习"],
      ["listen", "示范播放"],
    ],
  );
  assert.equal(await mode.inputValue(), "wait");
  assert.equal(await page.locator("header .primary").count(), 1);
  assert.equal(
    await page.getByRole("button", { name: "跟弹", exact: true }).count(),
    0,
  );
  const visuals = await assertVisuals(page);
  await settings(page);
  await page.getByLabel("练习双手", { exact: true }).selectOption("right");
  await closeSettings(page);
  await page.getByRole("button", { name: "开始", exact: true }).click();
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  const waiting = await playhead(page);
  await page.waitForTimeout(1100);
  assert(
    Math.abs((await playhead(page)) - waiting) < 0.5,
    "自由跟弹不应自动推进",
  );
  assert.equal((await snapshot(page)).starts.length, 0);
  assert.equal((await snapshot(page)).decoded.length, 0);
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "开始", exact: true }).waitFor();

  await selectMode(page, "free");
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "继续", exact: true }).waitFor();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  assert.equal(await mode.inputValue(), "free", "空格不应切换模式");
  await selectMode(page, "rhythm");
  await page.getByRole("button", { name: "开始", exact: true }).waitFor();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
  await page.keyboard.press("Space");
  await page.getByRole("button", { name: "开始", exact: true }).waitFor();
  assert.equal(await mode.inputValue(), "rhythm");
  assert.equal((await snapshot(page)).starts.length, 0);

  await selectMode(page, "listen");
  await settings(page);
  await page.getByLabel("起始小节", { exact: true }).fill("1");
  await page.getByLabel("结束小节", { exact: true }).fill("4");
  await page.getByLabel("循环练习", { exact: true }).uncheck();
  await closeSettings(page);
  assert.equal(
    await page.getByLabel("速度", { exact: true }).inputValue(),
    "75",
  );
  await page.evaluate(() => playbackProbe.resetSignal());
  await page.getByRole("button", { name: "播放", exact: true }).click();
  const audio = await assertAudible(page);
  await page.waitForTimeout(1200);
  const sustainedContact = await keyboardPixels(
    page,
    "playback-contact-sustained",
    true,
  );
  assert(
    sustainedContact.contactColors > 20,
    `持续发声1.2秒后交界没有彩色碎片：${JSON.stringify(sustainedContact)}`,
  );
  assert.equal(audio.midiRequests, 0, "电脑播放不应请求 MIDI 权限");
  const files = audio.starts.map((source) => new URL(source.url).pathname);
  assert(
    files.some((file) => file.endsWith("/C3.mp3")),
    "示范缺少左手",
  );
  assert(
    files.some((file) => file.endsWith("/C5.mp3")),
    "示范缺少右手",
  );
  const litKeys = await keyboardPixels(page, "playback-keys-active");
  assertLitKeyboard(litKeys);
  const moving = await playhead(page);
  await assertAdvances(page, moving);
  await page.screenshot({
    path: path.join(artifacts, "playback-browser-audio.png"),
  });
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const paused = await playhead(page);
  const quiet = await assertQuiet(page);
  assert(quiet.stops > 0, "暂停没有释放原生采样声源");
  assert(Math.abs((await playhead(page)) - paused) < 0.5, "暂停后仍在推进");
  const pausedKeys = await keyboardPixels(page, "playback-keys-paused");
  assert(
    pausedKeys.green < litKeys.green * 0.1 &&
      pausedKeys.purple < litKeys.purple * 0.1,
    `暂停后键盘未还原：${JSON.stringify(pausedKeys)}`,
  );

  // Listen is a normal persisted mode. It must retain its chosen range and
  // speed rather than relying on an ephemeral preview/practice snapshot.
  await settings(page);
  await page.getByLabel("起始小节", { exact: true }).fill("2");
  await page.getByLabel("结束小节", { exact: true }).fill("3");
  await page.getByLabel("循环练习", { exact: true }).check();
  await closeSettings(page);
  await page.getByLabel("速度", { exact: true }).press("ArrowLeft");
  const savedSpeed = await page
    .getByLabel("速度", { exact: true })
    .inputValue();
  await page.waitForTimeout(700);
  await page.reload();
  await page.locator(".music-card").filter({ hasText: title }).click();
  await readyScore(page);
  assert.equal(await mode.inputValue(), "listen");
  await settings(page);
  assert.equal(
    await page.getByLabel("练习双手", { exact: true }).inputValue(),
    "right",
  );
  assert.equal(
    await page.getByLabel("起始小节", { exact: true }).inputValue(),
    "2",
  );
  assert.equal(
    await page.getByLabel("结束小节", { exact: true }).inputValue(),
    "3",
  );
  assert(await page.getByLabel("循环练习", { exact: true }).isChecked());
  await closeSettings(page);
  assert.equal(
    await page.getByLabel("速度", { exact: true }).inputValue(),
    savedSpeed,
  );
  const startsBeforeLoop = (await snapshot(page)).starts.length;
  await page.evaluate(() => playbackProbe.resetSignal());
  await page.getByRole("button", { name: "播放", exact: true }).click();
  // Bars 2 and 3 each contain two simultaneous notes. Six new source starts
  // prove that the next pair has started after crossing the B-to-A boundary.
  await page.waitForFunction(
    (previous) => playbackProbe.state.starts.length >= previous + 6,
    startsBeforeLoop,
    { timeout: 10000 },
  );
  await page.waitForTimeout(150);
  await page.evaluate(() => playbackProbe.resetSignal());
  const loopAudio = await assertAudible(page);
  const loopKeys = await keyboardPixels(page, "playback-keys-loop-boundary");
  assertLitKeyboard(loopKeys);
  assert.equal(
    await page.locator(".result-score").count(),
    0,
    "示范循环不应生成练习评分",
  );
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await assertQuiet(page);
  const stoppedLoopKeys = await keyboardPixels(
    page,
    "playback-keys-loop-paused",
  );
  assert(
    stoppedLoopKeys.green < loopKeys.green * 0.1 &&
      stoppedLoopKeys.purple < loopKeys.purple * 0.1,
    "循环暂停后应还原键盘",
  );
  await settings(page);
  await page.getByLabel("循环练习", { exact: true }).uncheck();
  await page.getByLabel("起始小节", { exact: true }).fill("1");
  await page.getByLabel("结束小节", { exact: true }).fill("4");
  await closeSettings(page);
  await page.waitForTimeout(700);

  await page.waitForFunction(
    async () => {
      if (!navigator.serviceWorker.controller) return false;
      const requests = (
        await Promise.all(
          (await caches.keys()).map(async (key) =>
            (await caches.open(key)).keys(),
          ),
        )
      ).flat();
      return (
        new Set(
          requests
            .filter((request) => /\/audio\/piano\/.*\.mp3$/.test(request.url))
            .map((request) => request.url),
        ).size >= 30
      );
    },
    undefined,
    { timeout: 30000 },
  );
  await context.setOffline(true);
  await page.reload();
  await page.locator(".music-card").filter({ hasText: title }).click();
  await readyScore(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  const offlineAudio = await assertAudible(page);
  const offlineStart = await playhead(page);
  await assertAdvances(page, offlineStart);
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  await assertQuiet(page);
  await page.screenshot({ path: path.join(artifacts, "playback-offline.png") });
  return {
    waitDoesNotAdvance: true,
    actualPcm: audio.maxRms,
    bothHands: true,
    fourPeerModes: true,
    spaceTogglesCurrentMode: true,
    pauseReleasesSources: true,
    keyboardPixels: { playing: litKeys, paused: pausedKeys, loop: loopKeys },
    sustainedContactPixels: sustainedContact.contactColors,
    loopCrossesBoundaryWithAudioAndKeys: true,
    loopPcm: loopAudio.maxRms,
    selectedModeAndLoopPersist: true,
    offlinePcm: offlineAudio.maxRms,
    ...visuals,
  };
}
async function midiScenario(page) {
  await importFixture(page);
  await settings(page);
  await page.getByLabel("练习双手", { exact: true }).selectOption("right");
  await page.getByRole("tab", { name: "设备", exact: true }).click();
  await page.locator("#settings-device .device-status button").click();
  await page
    .getByLabel("MIDI 输入", { exact: true })
    .selectOption("playback-in");
  await page
    .getByLabel("MIDI 输出", { exact: true })
    .selectOption("playback-out");
  await closeSettings(page);
  await selectMode(page, "listen");
  await page.getByLabel("速度", { exact: true }).press("End");
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(
    () => {
      const notes = playbackProbe.state.sent
        .filter((data) => (data[0] & 240) === 144 && data[2] > 0)
        .map((data) => data[1]);
      return [48, 50, 52, 53, 72, 74, 76, 77].every((pitch) =>
        notes.includes(pitch),
      );
    },
    undefined,
    { timeout: 12000 },
  );
  await page.waitForTimeout(1500);
  const midi = await snapshot(page);
  assert.equal(midi.starts.length, 0, "MIDI 输出时不应叠加浏览器钢琴");
  assert.equal(midi.decoded.length, 0, "MIDI 输出无需加载钢琴采样");
  assert(midi.maxRms < 0.00001, "未开启节拍器时 MIDI 播放应无浏览器音频");
  const notesOn = midi.sent.filter(
    (data) => (data[0] & 240) === 144 && data[2] > 0,
  );
  const notesOff = midi.sent.filter((data) => (data[0] & 240) === 128);
  assert.equal(notesOn.length, 8, "整曲应包含四小节、左右手共八个音");
  assert.equal(
    notesOff.length,
    notesOn.length,
    "整曲结束应释放所有软件 MIDI 音符",
  );
  await page.screenshot({
    path: path.join(artifacts, "playback-midi-complete.png"),
  });
  return {
    wholeSongBothHands: true,
    notesOn: notesOn.length,
    notesOff: notesOff.length,
    browserSources: midi.starts.length,
  };
}
async function cancelScenario(page, _context, kind) {
  await importFixture(page);
  await selectMode(page, "listen");
  const before = await playhead(page);
  await page.getByRole("button", { name: "播放", exact: true }).click();
  await page.waitForFunction(() => playbackProbe.state.waiting > 0);
  if (kind === "home") {
    await page.getByRole("button", { name: "曲库", exact: true }).click();
    await page.locator(".music-card").filter({ hasText: title }).waitFor();
  } else {
    // Dispatch the same browser visibility notification deterministically. This
    // validates cancellation, without claiming a real iPad/OS background test.
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
  await page.evaluate(() => playbackProbe.releaseSamples());
  await page.waitForFunction(
    () => playbackProbe.state.decoded.length >= playbackProbe.state.waiting,
  );
  await assertQuiet(page);
  const cancelled = await snapshot(page);
  assert.equal(cancelled.starts.length, 0, "取消后异步加载完成仍启动了声音");
  if (kind === "home") {
    await page.locator(".music-card").filter({ hasText: title }).click();
    await readyScore(page);
  } else {
    const still = await playhead(page);
    await page.waitForTimeout(600);
    assert(
      Math.abs((await playhead(page)) - still) < 0.5,
      "切后台取消后仍自动推进",
    );
    assert(Math.abs(still - before) < 0.5, "采样加载期间不应推进控制线");
    await page.evaluate(() => {
      delete document.hidden;
      document.dispatchEvent(new Event("visibilitychange"));
    });
  }
  await page.screenshot({
    path: path.join(artifacts, `playback-cancel-${kind}.png`),
  });
  return {
    cancelled: kind,
    decodedRealSamples: cancelled.decoded.length,
    sourcesStarted: cancelled.starts.length,
    visibilityEventSimulated: kind === "hidden",
  };
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const reports = [];
  try {
    for (const [name, options, scenario] of [
      ["browser-and-offline", {}, mainScenario],
      ["midi-only", { midi: true }, midiScenario],
      [
        "cancel-home",
        { holdSamples: true },
        (page, context) => cancelScenario(page, context, "home"),
      ],
      [
        "cancel-hidden",
        { holdSamples: true },
        (page, context) => cancelScenario(page, context, "hidden"),
      ],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        locale: "zh-CN",
      });
      await context.addInitScript(installProbe, {
        midi: false,
        holdSamples: false,
        ...options,
      });
      const page = await context.newPage();
      page.setDefaultTimeout(30000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(String(error)));
      try {
        const result = await scenario(page, context);
        assert.deepEqual(errors, [], "页面出现未处理异常");
        reports.push({ name, passed: true, ...result });
      } catch (error) {
        await page.screenshot({
          path: path.join(artifacts, `playback-failure-${name}.png`),
        });
        reports.push({
          name,
          passed: false,
          error: String(error),
          pageErrors: errors,
          probe: await snapshot(page),
        });
        throw error;
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(artifacts, "playback-web.json"),
      JSON.stringify(
        {
          base,
          engine: "chromium",
          realWebAudio: true,
          simulatedMidi: true,
          realPianoTested: false,
          realIPadBackgroundTested: false,
          reports,
        },
        null,
        2,
      ),
    );
  }
  console.log(JSON.stringify(reports, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
