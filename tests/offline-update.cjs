const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { chromium } = require("playwright");

(async () => {
  const source = await fs.readFile(
    process.env.QINXI_SW_SOURCE || path.resolve(__dirname, "../public/sw.js"),
    "utf8",
  );
  let version = "A",
    scoreVersion = "A",
    allowUpdate = true;
  const scoreRequests = { selected: 0, unopened: 0 };
  const server = http.createServer((request, response) => {
    response.setHeader("Cache-Control", "no-cache");
    if (request.url === "/sw.js") {
      if (!allowUpdate) return response.writeHead(503).end();
      response.setHeader("Content-Type", "text/javascript");
      response.end(
        source
          .replace("__BUILD_ID__", version)
          .replace(
            '["__PRECACHE_FILES__"]',
            JSON.stringify(["./index.html", `./assets/${version}.js`]),
          ),
      );
    } else if (request.url === "/" || request.url === "/index.html") {
      response.setHeader("Content-Type", "text/html");
      response.end(
        `<!doctype html><h1>Update fixture</h1><script src="./assets/${version}.js"></script><script>navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>{});</script>`,
      );
    } else if (/^\/catalogue\/(selected|unopened)\.mid$/.test(request.url)) {
      const name = request.url.includes("selected.mid")
        ? "selected"
        : "unopened";
      scoreRequests[name]++;
      response.setHeader("Content-Type", "audio/midi");
      response.end(Buffer.from(`${name}-${scoreVersion}`));
    } else if (/^\/assets\/[AB]\.js$/.test(request.url)) {
      response.setHeader("Content-Type", "text/javascript");
      response.end(
        `document.documentElement.dataset.version=${JSON.stringify(request.url.includes("A.js") ? "A" : "B")};`,
      );
    } else response.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    const url = `http://127.0.0.1:${server.address().port}/`;
    const shown = () => page.locator("html").getAttribute("data-version");
    const fetchScore = (name, cache = "default") =>
      page.evaluate(
        async ({ name, cache }) =>
          (await fetch(`./catalogue/${name}.mid`, { cache })).text(),
        { name, cache },
      );
    await page.goto(url);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    assert.equal(await shown(), "A");
    assert.deepEqual(
      scoreRequests,
      { selected: 0, unopened: 0 },
      "安装时不应预取曲谱",
    );
    assert.equal(await fetchScore("selected", "reload"), "selected-A");
    assert.deepEqual(scoreRequests, { selected: 1, unopened: 0 });
    assert.equal(
      await page.evaluate(async () =>
        (
          await (
            await caches.open("qinxi-web-A")
          ).match("./catalogue/selected.mid")
        ).text(),
      ),
      "selected-A",
      "选中的曲谱应存入当前构建缓存",
    );
    assert.equal(await fetchScore("selected"), "selected-A");
    assert.equal(scoreRequests.selected, 1, "重复普通请求应复用曲谱缓存");
    scoreVersion = "B";
    assert.equal(await fetchScore("selected", "reload"), "selected-B");
    assert.equal(
      scoreRequests.selected,
      2,
      "reload 应联网获取同名曲谱的新内容",
    );
    await context.setOffline(true);
    assert.equal(await fetchScore("selected", "reload"), "selected-B");
    await assert.rejects(() => fetchScore("unopened"));
    assert.deepEqual(scoreRequests, { selected: 2, unopened: 0 });
    await context.setOffline(false);
    await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("piano-update-test", 1);
          request.onupgradeneeded = () =>
            request.result.createObjectStore("records");
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result,
              tx = db.transaction("records", "readwrite");
            tx.objectStore("records").put(
              { song: "test", beat: 12 },
              "practice",
            );
            tx.oncomplete = () => {
              db.close();
              resolve();
            };
            tx.onerror = () => reject(tx.error);
          };
        }),
    );

    version = "B";
    allowUpdate = false;
    await page.reload();
    assert.equal(
      await shown(),
      "B",
      "联网普通刷新应立即显示新构建，而非离线缓存的旧页面",
    );
    await context.setOffline(true);
    await page.reload();
    assert.equal(
      await shown(),
      "A",
      "更新未完整缓存时，离线应使用上一份完整构建",
    );

    await context.setOffline(false);
    allowUpdate = true;
    await page.reload();
    await page.evaluate(async () =>
      (await navigator.serviceWorker.getRegistration()).update(),
    );
    await page.waitForFunction(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return (
        (await caches.has("qinxi-web-B")) &&
        !registration.installing &&
        !registration.waiting &&
        registration.active?.state === "activated"
      );
    });
    await context.setOffline(true);
    await page.reload();
    assert.equal(await shown(), "B", "新构建完整缓存后可离线重载");
    assert.equal(
      await fetchScore("selected"),
      "selected-B",
      "构建更新后仍可从保留的曲谱缓存离线读取",
    );
    await assert.rejects(() => fetchScore("unopened"));
    assert.deepEqual(
      scoreRequests,
      { selected: 2, unopened: 0 },
      "未打开曲谱始终不应自动预取",
    );
    const record = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("piano-update-test", 1);
          request.onsuccess = () => {
            const db = request.result,
              read = db
                .transaction("records")
                .objectStore("records")
                .get("practice");
            read.onsuccess = () => {
              resolve(read.result);
              db.close();
            };
            read.onerror = () => reject(read.error);
          };
          request.onerror = () => reject(request.error);
        }),
    );
    assert.deepEqual(record, { song: "test", beat: 12 });
    console.log(
      JSON.stringify({
        passed: true,
        refreshLoadsLatest: true,
        incompleteUpdateKeepsOfflineBuild: true,
        offlineAfterUpdate: true,
        indexedDBPreserved: true,
        scoresPrecached: false,
        selectedScoreRuntimeCached: true,
        reloadRefreshesSelectedScore: true,
        selectedScoreOffline: true,
        unopenedScoreOfflineFails: true,
        previousBuildScoreCacheRetained: true,
        scoreRequests,
      }),
    );
  } finally {
    await browser.close();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
