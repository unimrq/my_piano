const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");

const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const artifacts = path.resolve(__dirname, "../test-results");
const title = "固定键宽回归测试";
const wide = [48, 72, 50, 71, 52, 69, 53, 67];
const narrow = [60, 62, 64, 65];
const pitches = Array.from({ length: 100 }, (_, i) =>
  i >= 32 && i < 68 ? narrow[i % narrow.length] : wide[i % wide.length],
);
for (const [index, midi] of [
  [12, 24],
  [50, 96],
  [88, 108],
])
  pitches[index] = midi;
const note = (midi) => {
  const step = ["C", "C", "D", "D", "E", "F", "F", "G", "G", "A", "A", "B"][
    midi % 12
  ];
  const alter = [1, 3, 6, 8, 10].includes(midi % 12) ? "<alter>1</alter>" : "";
  const left = midi < 60;
  return `<note><pitch><step>${step}</step>${alter}<octave>${Math.floor(midi / 12) - 1}</octave></pitch><duration>1</duration><type>quarter</type><staff>${left ? 2 : 1}</staff><notations><technical><fingering>${left ? 5 : 1}</fingering></technical></notations></note>`;
};
// Original notes: 97 quarter-note onsets in C3..C5, with three deliberately
// isolated C1/C7/C8 notes. Sparse extremes must not change this song's key size.
const score = `<score-partwise version="4.0"><work><work-title>${title}</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P">${Array.from(
  { length: 25 },
  (_, measure) =>
    `<measure number="${measure + 1}">${measure === 0 ? '<attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>' : ""}${pitches
      .slice(measure * 4, measure * 4 + 4)
      .map(note)
      .join("")}</measure>`,
).join("")}</part></score-partwise>`;

function installMidiAndObserver() {
  const input = {
    id: "range-in",
    name: "QA FP-30X",
    type: "input",
    state: "connected",
    onmidimessage: null,
  };
  const output = {
    id: "range-out",
    name: "QA FP-30X",
    type: "output",
    state: "connected",
    send() {},
  };
  Object.defineProperty(navigator, "requestMIDIAccess", {
    configurable: true,
    value: async () => ({
      inputs: new Map([[input.id, input]]),
      outputs: new Map([[output.id, output]]),
      onstatechange: null,
    }),
  });
  window.rangeNote = (midi, velocity) =>
    input.onmidimessage?.({
      data: new Uint8Array([velocity ? 144 : 128, midi, velocity]),
    });
  const probe = (window.rangeProbe = { enabled: false, observations: [] });
  const record = () => {
    if (!probe.enabled) return;
    for (const host of document.querySelectorAll(
      ".roll-keyboard[data-visible-whites]",
    )) {
      probe.observations.push({
        count: Number(host.dataset.visibleWhites),
        first: Number(host.dataset.firstWhite),
        free: host.classList.contains("free-play"),
      });
    }
  };
  probe.reset = () => {
    probe.observations = [];
    probe.enabled = true;
    record();
  };
  probe.stop = () => {
    probe.enabled = false;
  };
  const observer = new MutationObserver(record);
  observer.observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-visible-whites", "data-first-white"],
  });
}
const keys = (page) => page.locator(".roll-keyboard[data-visible-whites]");
async function widthIs(page, count) {
  await page.waitForFunction(
    (expected) =>
      Number(
        document.querySelector(".roll-keyboard")?.dataset.visibleWhites,
      ) === expected,
    count,
    { timeout: 15000 },
  );
}
async function readyScore(page) {
  await page.locator(".sheet-host svg").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".app")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector(".sheet-loading"),
  );
}
async function settings(page, tab) {
  await page.getByTitle("更多设置", { exact: true }).click();
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
const closeSettings = (page) => page.locator(".panel-heading button").click();
async function mode(page, value) {
  await page
    .locator("header")
    .getByLabel("练习模式", { exact: true })
    .selectOption(value);
  await page
    .getByLabel("练习模式", { exact: true })
    .evaluate((el) => el.blur());
}
async function stableObservations(page, expected) {
  await page.waitForTimeout(200);
  const observations = await page.evaluate(() => rangeProbe.observations);
  assert(observations.length > 0, "没有记录到键盘宽度");
  const counts = [...new Set(observations.map((entry) => entry.count))];
  assert.deepEqual(
    counts,
    [expected],
    `键盘宽度发生变化：${JSON.stringify(counts)}`,
  );
  return {
    counts,
    observations: observations.length,
    positions: [...new Set(observations.map((entry) => entry.first))].length,
  };
}
async function dragKeyboard(page, expected) {
  const before = Number(await keys(page).getAttribute("data-first-white"));
  const box = await keys(page).boundingBox();
  const canvas = await keys(page).locator(".upstream-keys").boundingBox();
  const x = box.x + box.width * 0.5;
  const y = canvas.y + canvas.height * 0.82;
  const delta = before < (52 - expected) / 2 ? -220 : 220;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + delta, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForFunction(
    (previous) =>
      Number(document.querySelector(".roll-keyboard").dataset.firstWhite) !==
      previous,
    before,
  );
  await widthIs(page, expected);
}
async function singleFarNoteReturns(page) {
  const home = Number(await keys(page).getAttribute("data-first-white"));
  const plot = page.getByLabel("上升音符", { exact: true });
  const previousNotes = Number(await plot.getAttribute("data-notes"));
  const observationStart = await page.evaluate(
    () => rangeProbe.observations.length,
  );
  await page.evaluate(() => rangeNote(108, 100));
  await page.waitForFunction(
    (initial) => {
      const host = document.querySelector(".free-play");
      const plot = host.querySelector('[aria-label="上升音符"]');
      return (
        plot.dataset.active === "1" &&
        Number(host.dataset.firstWhite) !== initial
      );
    },
    home,
    { timeout: 5000 },
  );
  const distant = Number(await keys(page).getAttribute("data-first-white"));
  assert(distant <= 51 && distant + 28 > 51, "平移后未显示按下的C8");
  await widthIs(page, 28);
  const releasedAt = await page.evaluate(() => {
    rangeNote(108, 0);
    return performance.now();
  });
  await page.waitForFunction(
    (initial) => {
      const host = document.querySelector(".free-play");
      return (
        Number(host.dataset.firstWhite) === initial &&
        host.querySelector('[aria-label="上升音符"]').dataset.active === "0"
      );
    },
    home,
    { timeout: 5000 },
  );
  const elapsed = await page.evaluate(
    (start) => performance.now() - start,
    releasedAt,
  );
  assert(
    elapsed >= 2000 && elapsed <= 5000,
    `松开远音后返回时间异常：${elapsed}ms`,
  );
  const historyNotes = Number(await plot.getAttribute("data-notes"));
  assert(historyNotes > previousNotes, "返回主音区时提前清除了上行音符历史");
  const observations = await page.evaluate(
    (start) => rangeProbe.observations.slice(start),
    observationStart,
  );
  const counts = [...new Set(observations.map((entry) => entry.count))];
  assert.deepEqual(counts, [28], "单个远音使键盘宽度发生变化");
  return { home, distant, returnMs: Math.round(elapsed), historyNotes, counts };
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
  await page.locator(".modal .track select").selectOption("staff");
  await page.getByLabel("自动生成缺失指法", { exact: true }).uncheck();
  await page.getByRole("button", { name: "加入曲库", exact: true }).click();
  await readyScore(page);
  await settings(page, "设备");
  await page.locator("#settings-device .device-status button").click();
  await page.getByLabel("MIDI 输入", { exact: true }).selectOption("range-in");
  await page.getByLabel("MIDI 输出", { exact: true }).selectOption("range-out");
  await closeSettings(page);
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "zh-CN",
  });
  await context.addInitScript(installMidiAndObserver);
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  const report = {
    base,
    engine: "chromium",
    simulatedMidi: true,
    realPianoTested: false,
  };
  page.on("pageerror", (error) => errors.push(String(error)));
  try {
    await importFixture(page);
    await widthIs(page, 28);
    await page.evaluate(() => rangeProbe.reset());
    assert.equal(
      await page.getByLabel("练习模式", { exact: true }).inputValue(),
      "wait",
    );
    await page.getByRole("button", { name: "开始", exact: true }).click();
    await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await page.evaluate(async (sequence) => {
      for (const midi of sequence) {
        rangeNote(midi, 100);
        await new Promise(requestAnimationFrame);
        rangeNote(midi, 0);
        await new Promise(requestAnimationFrame);
      }
    }, pitches);
    await page.locator(".result-score").waitFor();
    assert.match(await page.locator(".result-score").textContent(), /100/);
    assert.match(await page.locator(".result").textContent(), /正确\s*100/);
    report.complete100Notes = await stableObservations(page, 28);
    await page.getByRole("button", { name: "完成", exact: true }).click();

    for (const hand of ["left", "right", "both"]) {
      await settings(page, "练习");
      await page.getByLabel("练习双手", { exact: true }).selectOption(hand);
      await closeSettings(page);
      await widthIs(page, 28);
    }
    await mode(page, "listen");
    await page.getByRole("button", { name: "播放", exact: true }).click();
    await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await page.waitForTimeout(1000);
    await widthIs(page, 28);
    await page.getByRole("button", { name: "暂停", exact: true }).click();
    await mode(page, "rhythm");
    await widthIs(page, 28);
    await mode(page, "free");
    await page.getByLabel("上升音符", { exact: true }).waitFor();
    await widthIs(page, 28);
    report.freeSingleFarNoteReturns = await singleFarNoteReturns(page);
    await page.evaluate(() => {
      rangeNote(24, 100);
      rangeNote(108, 100);
    });
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="上升音符"]').dataset.active ===
        "2",
    );
    await page.waitForTimeout(1000);
    await widthIs(page, 28);
    await page.evaluate(() => {
      rangeNote(24, 0);
      rangeNote(108, 0);
    });
    await dragKeyboard(page, 28);
    report.sameSongHandsModesAndFarKeys = await stableObservations(page, 28);
    await page.screenshot({
      path: path.join(artifacts, "keyboard-range-default-28.png"),
    });
    await page.evaluate(() => rangeProbe.stop());

    await settings(page, "显示");
    await page.getByLabel("最少显示白键数", { exact: true }).fill("21");
    await page.getByLabel("最少显示白键数", { exact: true }).press("Tab");
    await closeSettings(page);
    await widthIs(page, 21);
    await page.evaluate(() => rangeProbe.reset());
    await page.evaluate(() => {
      rangeNote(24, 100);
      rangeNote(108, 100);
    });
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      rangeNote(24, 0);
      rangeNote(108, 0);
    });
    await dragKeyboard(page, 21);
    for (const value of ["wait", "listen", "rhythm", "free", "wait"]) {
      await mode(page, value);
      await widthIs(page, 21);
    }
    report.explicitMinimum21 = await stableObservations(page, 21);
    await page.screenshot({
      path: path.join(artifacts, "keyboard-range-explicit-21.png"),
    });
    await page.evaluate(() => rangeProbe.stop());

    await settings(page, "显示");
    await page.getByLabel("键盘音区", { exact: true }).selectOption("full");
    await closeSettings(page);
    await widthIs(page, 52);
    await page.evaluate(() => rangeProbe.reset());
    await page.evaluate(() => {
      rangeNote(24, 100);
      rangeNote(108, 100);
    });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      rangeNote(24, 0);
      rangeNote(108, 0);
    });
    report.explicitFull52 = await stableObservations(page, 52);
    await page.screenshot({
      path: path.join(artifacts, "keyboard-range-52.png"),
    });
    await page.evaluate(() => rangeProbe.stop());

    await page.getByRole("button", { name: "曲库", exact: true }).click();
    const porcelain = page.locator(".music-card").filter({ hasText: "青花瓷" });
    if (await porcelain.count()) {
      await porcelain.first().click();
      await readyScore(page);
      await widthIs(page, 28);
      await page.evaluate(() => rangeProbe.reset());
      const paper = await page.locator(".sheet").boundingBox();
      await page.mouse.move(
        paper.x + paper.width * 0.75,
        paper.y + paper.height * 0.55,
      );
      await page.mouse.down();
      await page.mouse.move(
        paper.x + paper.width * 0.3,
        paper.y + paper.height * 0.55,
        { steps: 10 },
      );
      await page.mouse.up();
      assert(
        (await page.locator(".sheet").evaluate((el) => el.scrollLeft)) > 0,
        "谱面拖动没有发生",
      );
      const measure = page.locator('.sheet-host [data-measure="10"]').first();
      await measure.scrollIntoViewIfNeeded();
      await measure.click();
      await widthIs(page, 28);
      await page.getByRole("button", { name: "重来", exact: true }).click();
      await page.getByLabel("速度", { exact: true }).press("End");
      await widthIs(page, 28);
      report.porcelain = {
        skipped: false,
        ...(await stableObservations(page, 28)),
      };
      await page.screenshot({
        path: path.join(artifacts, "keyboard-range-porcelain-28.png"),
      });
    } else {
      report.porcelain = {
        skipped: true,
        reason: "当前构建未包含本机个人曲目青花瓷",
      };
    }
    assert.deepEqual(errors, [], "页面出现未处理异常");
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = String(error);
    report.pageErrors = errors;
    report.observed = await page.evaluate(() => rangeProbe.observations);
    await page.screenshot({
      path: path.join(artifacts, "keyboard-range-failure.png"),
    });
    throw error;
  } finally {
    await browser.close();
    await fs.writeFile(
      path.join(artifacts, "keyboard-range-web.json"),
      JSON.stringify(report, null, 2),
    );
  }
  console.log(JSON.stringify(report, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
