const { chromium, webkit } = require("playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const whites = Array.from({ length: 88 }, (_, i) => i + 21).filter(
  (m) => ![1, 3, 6, 8, 10].includes(m % 12),
);
async function keyPosition(page, midi) {
  return page.locator(".roll-keyboard").evaluate((host, index) => {
    const box = host.getBoundingClientRect(),
      keys = host.querySelector(".upstream-keys").getBoundingClientRect();
    const low = Number(host.dataset.firstWhite),
      count = Number(host.dataset.visibleWhites);
    return {
      x: box.left + ((index + 0.5 - low) * box.width) / count,
      y: keys.top + keys.height * 0.8,
    };
  }, whites.indexOf(midi));
}
(async () => {
  for (const [engine, name] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ]) {
    const browser = await engine.launch({ headless: true });
    const page = await browser.newPage({
        viewport: { width: 1280, height: 800 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.addInitScript(() => {
      window.pointerEvents = [];
      for (const type of ["pointerdown", "pointermove", "pointerup"])
        document.addEventListener(
          type,
          (e) => {
            window.pointerEvents.push({
              type,
              x: e.clientX,
              time: performance.now(),
            });
            if (window.pointerEvents.length > 30) window.pointerEvents.shift();
          },
          true,
        );
    });
    try {
      await page.goto(base);
      await page.locator(".music-card").filter({ hasText: "欢乐颂" }).click();
      await page.locator('.sheet-host[aria-busy="false"]').waitFor();
      await page.getByTitle("更多设置", { exact: true }).click();
      await page.getByRole("tab", { name: "练习", exact: true }).click();
      await page.getByLabel("练习双手", { exact: true }).selectOption("right");
      await page.locator(".panel-heading button").click();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "开始", exact: true }).waitFor();
      await page.getByRole("button", { name: "开始", exact: true }).click();
      await page.keyboard.press("Space");
      await page.getByRole("button", { name: "开始", exact: true }).waitFor();

      await page.getByTitle("更多设置", { exact: true }).click();
      await page.getByRole("tab", { name: "显示", exact: true }).click();
      await page.getByLabel("最少显示白键数", { exact: true }).focus();
      await page.keyboard.press("Space");
      assert.equal(
        await page.getByRole("button", { name: "暂停", exact: true }).count(),
        0,
      );
      await page.locator(".panel-heading button").click();
      await page.getByRole("button", { name: "开始", exact: true }).click();
      await page.waitForTimeout(800);
      const firstLine = await page
        .locator(".score-playhead")
        .evaluate((el) => Number.parseFloat(el.style.left));
      const key = await keyPosition(page, 64);
      await page.mouse.click(key.x, key.y);
      await page
        .locator('.score-mark[data-status="correct"]')
        .first()
        .waitFor();
      await page.mouse.click(key.x, key.y);
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.score-mark[data-status="correct"]')
            .length >= 2,
      );
      const before = Number(
        await page.locator(".roll-keyboard").getAttribute("data-first-white"),
      );
      const marks = await page.locator(".score-mark").count();
      await page.mouse.move(700, key.y);
      await page.mouse.down();
      await page.mouse.move(470, key.y, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      assert(
        Number(
          await page.locator(".roll-keyboard").getAttribute("data-first-white"),
        ) >
          before + 1,
      );
      assert.equal(
        await page.locator(".score-mark").count(),
        marks,
        "拖动不能误弹",
      );
      await page.getByRole("button", { name: "暂停", exact: true }).click();

      await page.locator('.sheet-host [data-measure="5"]').first().click();
      await page.getByRole("button", { name: "重来", exact: true }).click();
      await page.waitForTimeout(250);
      assert(
        Math.abs(
          (await page
            .locator(".score-playhead")
            .evaluate((el) => Number.parseFloat(el.style.left))) - firstLine,
        ) < 1,
      );
      assert.equal(
        await page.locator(".sheet").evaluate((el) => el.scrollLeft),
        0,
      );

      await page.getByLabel("练习模式", { exact: true }).selectOption("free");
      const plot = page.getByLabel("上升音符", { exact: true });
      await plot.waitFor();
      await page.waitForTimeout(800);
      const freeKey = await keyPosition(page, 64);
      await page.mouse.move(freeKey.x, freeKey.y);
      await page.mouse.down();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.active ===
          "1",
      );
      await page.mouse.up();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="上升音符"]').dataset.active ===
          "0",
      );
      await page.getByRole("button", { name: "暂停", exact: true }).click();
      await page.getByRole("button", { name: "继续", exact: true }).waitFor();
      await page.waitForTimeout(120);
      const frozen = await plot.evaluate((c) => c.toDataURL());
      await page.waitForTimeout(250);
      assert.equal(
        await plot.evaluate((c) => c.toDataURL()),
        frozen,
        "暂停后上升音符应停止",
      );
      await page.getByRole("button", { name: "继续", exact: true }).click();
      await page.waitForTimeout(250);
      assert.notEqual(await plot.evaluate((c) => c.toDataURL()), frozen);
      const notes = await plot.getAttribute("data-notes");
      const freeBefore = Number(
        await page.locator(".free-play").getAttribute("data-first-white"),
      );
      await page.mouse.move(700, freeKey.y);
      await page.mouse.down();
      await page.mouse.move(470, freeKey.y, { steps: 8 });
      await page.mouse.up();
      assert(
        Number(
          await page.locator(".free-play").getAttribute("data-first-white"),
        ) >
          freeBefore + 1,
      );
      assert.equal(await plot.getAttribute("data-notes"), notes);
      await page.screenshot({
        path: path.resolve(__dirname, `../test-results/键盘交互-${name}.png`),
      });
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          engine: name,
          spaceToggle: true,
          inputGuard: true,
          screenKeysWithoutMidi: true,
          repeatNotes: true,
          dragWithoutNotes: true,
          restartFirstBar: true,
          freePause: true,
          passed: true,
        }),
      );
    } catch (error) {
      await page.screenshot({
        path: path.resolve(
          __dirname,
          `../test-results/键盘交互失败-${name}.png`,
        ),
      });
      console.error(errors);
      console.error(await page.evaluate(() => window.pointerEvents));
      throw error;
    } finally {
      await browser.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
