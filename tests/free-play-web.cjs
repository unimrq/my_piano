const { chromium, webkit } = require("playwright"),
  path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
(async () => {
  await fs.mkdir(path.resolve(__dirname, "../test-results"), {
    recursive: true,
  });
  for (const [engine, name] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      });
      await context.addInitScript(() => {
        const input = {
          id: "free-in",
          name: "QA FP-30X",
          type: "input",
          state: "connected",
          onmidimessage: null,
        };
        window.sent = [];
        const output = {
          id: "free-out",
          name: "QA FP-30X",
          type: "output",
          state: "connected",
          send: (data) => window.sent.push([...data]),
        };
        Object.defineProperty(navigator, "requestMIDIAccess", {
          value: async () => ({
            inputs: new Map([[input.id, input]]),
            outputs: new Map([[output.id, output]]),
          }),
        });
        window.note = (m, v) =>
          input.onmidimessage?.({
            data: new Uint8Array([v ? 144 : 128, m, v]),
          });
      });
      const page = await context.newPage(),
        errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base);
      await page.locator(".music-card").first().waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "自由练习", exact: true })
          .count(),
        0,
      );
      await page.locator(".music-card").first().click();
      await page.locator(".sheet-host svg").first().waitFor();
      const title = await page.locator(".song-name").textContent();
      await page.getByLabel("练习模式", { exact: true }).selectOption("free");
      const plot = page.getByLabel("上升音符", { exact: true });
      await plot.waitFor();
      assert.equal(await page.locator(".sheet").count(), 1);
      assert.equal(await page.locator(".song-name").textContent(), title);
      await page.locator(".sheet-host svg").first().waitFor();
      assert.equal(
        await page.getByRole("button", { name: "暂停", exact: true }).count(),
        1,
      );
      await page.getByTitle("更多设置", { exact: true }).click();
      assert.equal(
        await page.getByRole("tab", { name: "练习", exact: true }).count(),
        1,
      );
      await page.getByRole("tab", { name: "设备", exact: true }).click();
      await page.getByRole("button", { name: "连接钢琴", exact: true }).click();
      await page.getByLabel("MIDI 输入").selectOption("free-in");
      await page.locator(".panel-heading button").click();
      await page.evaluate(() => window.note(64, 100));
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.active ===
          "1",
      );
      await page.waitForTimeout(250);
      const top = () =>
        plot.evaluate((c) => {
          const x = Math.floor((25.5 * c.width) / 52);
          const data = c.getContext("2d").getImageData(x, 0, 1, c.height).data;
          for (let y = 0; y < c.height; y++) if (data[y * 4 + 3] > 0) return y;
          return c.height;
        });
      const first = await top();
      await page.waitForTimeout(300);
      assert((await top()) < first, "音符应向上移动");
      await page.evaluate(() => {
        window.note(64, 0);
        for (const m of [48, 60, 67]) window.note(m, 100);
      });
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.active ===
          "3",
      );
      await page.waitForTimeout(350);
      await page.screenshot({
        path: path.resolve(__dirname, `../test-results/自由练习-${name}.png`),
      });
      await page.evaluate(() => [48, 60, 67].forEach((m) => window.note(m, 0)));
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.active ===
          "0",
      );
      assert(Number(await plot.getAttribute("data-notes")) >= 4);
      assert.equal(await page.locator(".result-score").count(), 0);
      assert.equal(
        await page.evaluate(
          () =>
            window.sent.filter((d) => (d[0] & 240) === 144 && d[2] > 0).length,
        ),
        0,
      );
      await page.getByRole("button", { name: "清空", exact: true }).click();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.notes ===
          "0",
      );
      const fixedFreeKeys = Number(
        await page.locator(".free-play").getAttribute("data-visible-whites"),
      );
      await page.evaluate(() => [24, 103].forEach((m) => window.note(m, 100)));
      await page.waitForTimeout(200);
      assert.equal(
        Number(
          await page.locator(".free-play").getAttribute("data-visible-whites"),
        ),
        fixedFreeKeys,
      );
      await page.evaluate(() => {
        [24, 103].forEach((m) => window.note(m, 0));
        window.note(64, 100);
      });
      await page.waitForTimeout(200);
      assert.equal(
        Number(
          await page.locator(".free-play").getAttribute("data-visible-whites"),
        ),
        fixedFreeKeys,
      );
      await page.evaluate(() => window.note(64, 0));
      await page.getByRole("button", { name: "曲库", exact: true }).click();
      // The selected mode belongs only to this song, and survives a browser reload.
      await page.reload();
      await page.locator(".music-card").first().click();
      await plot.waitFor();
      assert.equal(await page.locator(".song-name").textContent(), title);
      assert.equal(await page.locator(".sheet").count(), 1);
      assert.equal(
        await page.getByLabel("练习模式", { exact: true }).inputValue(),
        "free",
      );
      await page.getByLabel("练习模式", { exact: true }).selectOption("wait");
      await page.getByLabel("下落音符", { exact: true }).waitFor();
      assert.equal(await plot.count(), 0);
      assert.equal(await page.locator(".song-name").textContent(), title);
      await page.getByTitle("更多设置", { exact: true }).click();
      await page.getByRole("tab", { name: "设备", exact: true }).click();
      await page.getByRole("button", { name: "连接钢琴", exact: true }).click();
      await page.getByLabel("MIDI 输入").selectOption("free-in");
      await page.locator(".panel-heading button").click();
      await page.waitForTimeout(250);
      const initialKeys = Number(
        await page
          .locator(".roll-keyboard")
          .getAttribute("data-visible-whites"),
      );
      await page.evaluate(() => [24, 103].forEach((m) => window.note(m, 100)));
      await page.waitForTimeout(200);
      assert.equal(
        Number(
          await page
            .locator(".roll-keyboard")
            .getAttribute("data-visible-whites"),
        ),
        initialKeys,
      );
      await page.evaluate(() => [24, 103].forEach((m) => window.note(m, 0)));
      await page.waitForTimeout(200);
      assert.equal(
        Number(
          await page
            .locator(".roll-keyboard")
            .getAttribute("data-visible-whites"),
        ),
        initialKeys,
      );
      await page.getByLabel("练习模式", { exact: true }).selectOption("free");
      await plot.waitFor();
      assert.equal(await plot.getAttribute("data-notes"), "0");
      await page.getByRole("button", { name: "曲库", exact: true }).click();
      await page.locator(".music-card").nth(1).click();
      await page.getByLabel("下落音符", { exact: true }).waitFor();
      assert.equal(await plot.count(), 0);
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          engine: name,
          upwardPixels: true,
          chords: true,
          releases: true,
          clear: true,
          noScore: true,
          noMidiEcho: true,
          songScoreRetained: true,
          perSongModeSaved: true,
          switchBackToWait: true,
          otherSongUnchanged: true,
          fixedKeyboardWidth: true,
          farKeysDoNotResize: true,
          passed: true,
        }),
      );
    } finally {
      await browser.close();
    }
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
