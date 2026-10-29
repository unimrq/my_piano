const { chromium, webkit } = require("playwright");
const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const artifacts = path.resolve(__dirname, "../test-results");
async function library(page) {
  return page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("qinxi-piano", 1);
        req.onsuccess = () => {
          const db = req.result;
          const r = db.transaction("data").objectStore("data").get("library");
          r.onsuccess = () => {
            resolve(r.result);
            db.close();
          };
          r.onerror = () => reject(r.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
}
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  for (const [engine, name] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ]) {
    const browser = await engine.launch({ headless: true });
    try {
      const context = await browser.newContext();
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.goto(base);
      await page.locator(".music-card").first().waitFor();
      const target = page
        .locator(".music-card")
        .filter({ hasText: "刻在我心底的名字" });
      if (await target.count()) await target.click();
      else await page.locator(".music-card").first().click();
      await page.locator(".sheet-host svg").first().waitFor();
      const before = await library(page);
      const original = before.songs.find((s) => s.id === before.lastSong);
      await page.getByTitle("更多设置", { exact: true }).click();
      await page.getByRole("tab", { name: "练习", exact: true }).click();
      await page.locator("summary").filter({ hasText: "自动指法" }).click();
      await page
        .getByRole("button", { name: "生成缺失指法", exact: true })
        .click();
      await page
        .getByRole("status")
        .filter({ hasText: "已生成" })
        .waitFor({ timeout: 60000 });
      const saved = await library(page);
      const song = saved.songs.find((s) => s.id === original.id);
      assert(song.xml.includes("<fingering>"));
      assert(song.notes.some((n) => n.finger));
      assert.deepEqual(
        song.notes.map((n) => [n.id, n.midi, n.beat, n.duration, n.hand]),
        original.notes.map((n) => [n.id, n.midi, n.beat, n.duration, n.hand]),
      );
      await page.locator(".panel-heading button").click();
      await page.locator(".sheet-host svg").first().waitFor();
      await page.screenshot({
        path: path.join(artifacts, `自动指法-${name}.png`),
      });
      const labels = await page
        .locator(".sheet-host svg text")
        .allTextContents();
      assert(
        labels.filter((text) => /^[1-5]$/.test(text)).length >=
          Math.min(5, song.notes.filter((n) => n.finger).length),
      );
      await page.reload();
      await page.locator(".music-card").first().waitFor();
      const restored = await library(page);
      assert.equal(restored.songs.find((s) => s.id === song.id).xml, song.xml);
      if (name === "chromium") {
        await page.evaluate(() => navigator.serviceWorker.ready);
        await page.waitForFunction(() => !!navigator.serviceWorker.controller);
        await context.setOffline(true);
        await page.reload();
        await page.locator(".music-card").first().waitFor();
        await page.locator(".music-card").first().click();
        await page.locator(".sheet-host svg").first().waitFor();
        await page.getByTitle("更多设置", { exact: true }).click();
        await page.getByRole("tab", { name: "练习", exact: true }).click();
        await page.locator("summary").filter({ hasText: "自动指法" }).click();
        await page
          .getByRole("button", { name: "生成缺失指法", exact: true })
          .click();
        await page
          .getByRole("status")
          .filter({ hasText: "已生成" })
          .waitFor({ timeout: 60000 });
      }
      assert.deepEqual(errors, []);
      console.log(
        JSON.stringify({
          engine: name,
          title: song.title,
          assigned: song.notes.filter((n) => n.finger).length,
          total: song.notes.length,
          worker: true,
          reload: true,
          offline: name === "chromium",
          passed: true,
        }),
      );
    } finally {
      await browser.close();
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
