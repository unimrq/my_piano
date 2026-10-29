const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const artifacts = path.resolve(__dirname, "../test-results");

async function run(engine, name) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    const realNow = Date.now;
    window.timeOffset = 0;
    Date.now = () => realNow() + window.timeOffset;
    window.timeStoreLog = [];
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (key === "practice-spans")
        window.timeStoreLog.push({
          kind: "put",
          at: Date.now(),
          value: structuredClone(value),
        });
      return put.call(this, value, key);
    };
    const input = {
      id: "time-in",
      name: "QA FP-30X",
      type: "input",
      state: "connected",
      onmidimessage: null,
    };
    const output = {
      id: "time-out",
      name: "QA FP-30X",
      type: "output",
      state: "connected",
      send() {},
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => ({
        inputs: new Map([[input.id, input]]),
        outputs: new Map([[output.id, output]]),
      }),
    });
    window.note = (key, value) =>
      input.onmidimessage?.({
        data: new Uint8Array([value ? 144 : 128, key, value]),
      });
    window.readPractice = () =>
      new Promise((resolve, reject) => {
        const open = indexedDB.open("qinxi-piano", 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db
            .transaction("data")
            .objectStore("data")
            .get("practice-spans");
          request.onsuccess = () => {
            window.timeStoreLog.push({
              kind: "read",
              at: Date.now(),
              value: structuredClone(request.result ?? []),
            });
            if (window.timeStoreLog.length > 100)
              window.timeStoreLog.splice(0, 25);
            resolve(request.result ?? []);
            db.close();
          };
          request.onerror = () => {
            reject(request.error);
            db.close();
          };
        };
      });
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const stored = () => page.evaluate(() => window.readPractice());
  const waitCount = async (count) => {
    const until = Date.now() + 15_000;
    let spans;
    do {
      spans = await stored();
      if (spans.length === count) return spans;
      await page.waitForTimeout(100);
    } while (Date.now() < until);
    assert.equal(spans.length, count, "练琴记录未按时保存");
  };
  const mode = (value) =>
    page.getByLabel("练习模式", { exact: true }).selectOption(value);
  const primary = (label) =>
    page.getByRole("button", { name: label, exact: true });
  const note = (key, value) =>
    page.evaluate(
      ([m, v]) => {
        const at = Date.now();
        window.note(m, v);
        return at;
      },
      [key, value],
    );
  const connect = async () => {
    await page.getByTitle("更多设置", { exact: true }).click();
    await page.getByRole("tab", { name: "设备", exact: true }).click();
    await page.getByRole("button", { name: "连接钢琴", exact: true }).click();
    await page.getByLabel("MIDI 输入").selectOption("time-in");
    await page.locator(".panel-heading button").click();
  };
  try {
    await page.goto(base);
    await page.locator(".music-card").first().click();
    await page.locator(".sheet-host svg").first().waitFor();
    const title = await page.locator(".song-name").textContent();
    await mode("free");
    await connect();
    const downAt = await note(60, 100);
    await page.waitForTimeout(1100);
    const upAt = await note(60, 0);
    await primary("暂停").click();
    const initialData = await waitCount(1);
    assert.equal(initialData.length, 1, "等待长度为1后再次读取发生变化");
    const initial = initialData[0];
    assert.equal(initial.title, title);
    assert.equal(initial.mode, "free");
    assert(Math.abs(initial.startedAt - downAt) < 100);
    assert(Math.abs(initial.endedAt - upAt) < 100);
    assert(Math.abs(initial.durationMs - (upAt - downAt)) < 100);
    assert(initial.durationMs >= 900, "必须记录真实弹奏时间");
    await note(64, 100);
    await page.waitForTimeout(200);
    await note(64, 0);
    await page.waitForTimeout(500);
    assert.deepEqual(await stored(), [initial], "自由练习暂停后不能继续计时");

    await primary("继续").click();
    await note(62, 100);
    await page.waitForTimeout(250);
    await note(62, 0);
    await page.evaluate(() => {
      window.timeOffset += 31_000;
    });
    await note(65, 100);
    await page.waitForTimeout(250);
    await note(65, 0);
    await primary("暂停").click();
    const separated = await waitCount(3);
    const short = separated
      .filter((span) => span.id !== initial.id)
      .sort((a, b) => a.startedAt - b.startedAt);
    assert.equal(short.length, 2);
    assert(
      short.every((span) => span.durationMs >= 200 && span.durationMs < 3000),
    );
    assert(short[1].startedAt - short[0].endedAt >= 31_000);
    assert(
      separated.reduce((sum, span) => sum + span.durationMs, 0) < 8000,
      "空闲间隔被错误累计",
    );
    await primary("曲库").click();
    await note(67, 100);
    await note(67, 0);
    await page.locator(".nav-history").click();
    const history = page.getByRole("region", { name: "练琴时长" });
    await history.waitFor();
    assert.match(await history.textContent(), /今日/);
    assert.match(await history.textContent(), /累计/);
    assert.equal(await history.locator(".practice-time-row").count(), 3);
    assert.equal(
      await page.locator(".practice-results").getAttribute("open"),
      null,
    );
    assert.deepEqual(await stored(), separated, "曲库页面输入不能计时");
    await page.screenshot({
      path: path.join(artifacts, `practice-time-${name}.png`),
    });
    await page.reload();
    await page.locator(".music-card").first().waitFor();
    assert.deepEqual(await stored(), separated, "重载后练琴时间应保留");

    await page.locator(".music-card").first().click();
    await page.locator(".sheet-host svg").first().waitFor();
    await connect();
    await mode("listen");
    await primary("播放").click();
    await primary("暂停").waitFor();
    await note(60, 100);
    await page.waitForTimeout(1100);
    await note(60, 0);
    await primary("暂停").click();
    await page.waitForTimeout(500);
    assert.deepEqual(await stored(), separated, "示范播放不能累计练琴时间");

    await mode("free");
    await page.getByLabel("上升音符", { exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        Number(document.querySelector(".free-play")?.dataset.visibleWhites) > 0,
    );
    const key = await page.locator(".free-play").evaluate((host) => {
      const box = host.getBoundingClientRect(),
        keys = host.querySelector(".upstream-keys").getBoundingClientRect();
      const count = Number(host.dataset.visibleWhites);
      return {
        x: box.left + ((Math.floor(count / 2) + 0.5) * box.width) / count,
        y: keys.top + keys.height * 0.82,
      };
    });
    await page.mouse.move(key.x, key.y);
    await page.mouse.down();
    await page.waitForTimeout(1100);
    await page.mouse.up();
    await primary("暂停").click();
    const withScreen = await waitCount(4);
    const screenSpan = withScreen.find(
      (span) => !separated.some((old) => old.id === span.id),
    );
    assert(screenSpan?.durationMs >= 400, "屏幕琴键按住应计时");
    assert.equal(screenSpan.mode, "free");
    await primary("继续").click();
    await note(69, 100);
    await page.waitForTimeout(250);
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: true,
      });
      document.dispatchEvent(new Event("visibilitychange"));
      window.note(69, 0);
      window.note(72, 100);
      window.note(72, 0);
    });
    const background = await waitCount(5);
    await page.waitForTimeout(500);
    assert.deepEqual(await stored(), background, "后台输入不能继续计时");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", {
        configurable: true,
        value: false,
      });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert.deepEqual(errors, []);
    return {
      engine: name,
      passed: true,
      realMidiHoldMs: initial.durationMs,
      spans: background.length,
      simulatedMidi: true,
      simulatedIdleClockOnly: true,
      realPianoTested: false,
    };
  } catch (error) {
    const diagnostic = await page.evaluate(async () => ({
      stored: await window.readPractice(),
      log: window.timeStoreLog,
      mode: document.querySelector('[aria-label="练习模式"]')?.value,
      primary: document.querySelector("header .primary")?.textContent,
      hidden: document.hidden,
    }));
    await fs.writeFile(
      path.join(artifacts, `practice-time-failure-${name}.json`),
      JSON.stringify({ error: String(error), errors, ...diagnostic }, null, 2),
    );
    await page.screenshot({
      path: path.join(artifacts, `practice-time-failure-${name}.png`),
    });
    console.error(JSON.stringify({ error: String(error), ...diagnostic }));
    throw error;
  } finally {
    await browser.close();
  }
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const reports = [];
  for (const [engine, name] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ])
    reports.push(await run(engine, name));
  await fs.writeFile(
    path.join(artifacts, "practice-time-web.json"),
    JSON.stringify(reports, null, 2),
  );
  console.log(JSON.stringify(reports, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
