const fsSync = require("node:fs");
const path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { openFixture } = require("./browser-fixture.cjs");
const root = path.resolve(__dirname, ".."),
  base = process.env.QINXI_WEB_URL || "http://localhost:4173",
  artifacts = path.join(root, "test-results");
async function run(engine, name) {
  const personalPath = path.join(root, "src/personal-catalogue.json");
  const catalogueCount =
    JSON.parse(
      await fs.readFile(
        path.join(root, "public/catalogue/manifest.json"),
        "utf8",
      ),
    ).length +
    (fsSync.existsSync(personalPath)
      ? JSON.parse(await fs.readFile(personalPath, "utf8")).length
      : 0);
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
    locale: "zh-CN",
  });
  const page = await context.newPage(),
    errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await context.addInitScript(() => {
    const input = {
      id: "test-in",
      name: "QA FP-30X",
      type: "input",
      state: "connected",
      onmidimessage: null,
    };
    const output = {
      id: "test-out",
      name: "QA FP-30X",
      type: "output",
      state: "connected",
      send: (data) => window.sent.push([...data]),
    };
    window.sent = [];
    window.midiRequests = 0;
    Object.defineProperty(navigator, "requestMIDIAccess", {
      configurable: true,
      value: async () => {
        window.midiRequests++;
        return {
          inputs: new Map([[input.id, input]]),
          outputs: new Map([[output.id, output]]),
          onstatechange: null,
        };
      },
    });
    window.note = (m, v) =>
      input.onmidimessage?.({ data: new Uint8Array([v ? 144 : 128, m, v]) });
  });
  try {
    await page.goto(base);
    await page
      .getByText(`${catalogueCount} 首本地曲目`, { exact: true })
      .waitFor();
    assert.equal(await page.locator(".window-controls").count(), 0);
    assert.equal(await page.evaluate(() => window.midiRequests), 0);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.locator(".home-device").tap();
    await page
      .locator(".settings-panel")
      .getByRole("button", { name: "连接钢琴", exact: true })
      .tap();
    await page.getByLabel("MIDI 输入").selectOption("test-in");
    await page.locator(".panel-heading button").tap();
    const nameCard = page
      .locator(".music-card")
      .filter({ hasText: "刻在我心底的名字" });
    if (await nameCard.count()) await nameCard.tap();
    else await page.locator(".music-card").first().tap();
    await page.locator(".sheet-host svg").first().waitFor();
    await page.waitForTimeout(1000);
    if (
      await page
        .locator(".song-name")
        .textContent()
        .then((text) => text.includes("刻在我心底的名字"))
    ) {
      const section = page.locator('.sheet-host [data-measure="21"]').first();
      // Existing scores now gain fingerings on entry, which replaces the SVG.
      await page.waitForFunction(
        () =>
          document.querySelector(".app")?.getAttribute("aria-busy") === "false",
      );
      await page.waitForFunction(
        () => document.querySelectorAll(".sheet-host svg text").length > 100,
      );
      await section.evaluate((el) => {
        const sheet = el.closest(".sheet");
        sheet.scrollLeft +=
          el.getBoundingClientRect().left - sheet.getBoundingClientRect().left;
      });
      // VexFlow draws the triplet number directly, without a tuplet CSS group.
      const bar = section.locator(
        'xpath=ancestor::*[contains(@class,"vf-measure")][1]',
      );
      await bar.locator(':scope > path[d*="C"]').first().waitFor();
      await page.screenshot({
        path: path.join(artifacts, `刻在我心底的名字-三连音-${name}.png`),
      });
      await page.locator(".sheet").evaluate((el) => {
        el.scrollLeft = 0;
      });
    }
    assert.equal(await page.locator(".timeline").count(), 0);
    assert.equal(
      await page
        .locator(".sheet")
        .evaluate((el) => el.nextElementSibling.className),
      "resize",
    );
    const centering = await page.locator(".sheet").evaluate((el) => {
      const outer = el.getBoundingClientRect();
      let graphic = el.querySelector(".sheet-host").getBoundingClientRect();
      if (graphic.height >= el.clientHeight - 2) {
        const svg = el.querySelector(".sheet-host svg"),
          bbox = svg.getBBox(),
          matrix = svg.getScreenCTM();
        graphic = {
          top: bbox.y * matrix.d + matrix.f,
          bottom: (bbox.y + bbox.height) * matrix.d + matrix.f,
        };
      }
      const top = graphic.top - outer.top - el.clientTop;
      const bottom =
        outer.top + el.clientTop + el.clientHeight - graphic.bottom;
      return { top, bottom, difference: Math.abs(top - bottom) };
    });
    assert(
      centering.top >= -1 &&
        centering.bottom >= -1 &&
        centering.difference <= 6,
      JSON.stringify(centering),
    );
    const geometry = await page.locator(".upstream-keys").boundingBox();
    assert(geometry.y + geometry.height <= 768);
    await page.screenshot({
      path: path.join(artifacts, `网页横屏-${name}.png`),
    });
    if (name === "chromium") {
      const session = await context.newCDPSession(page);
      const drag = async (x1, y1, x2, y2) => {
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [{ x: x1, y: y1 }],
        });
        for (let i = 1; i <= 8; i++)
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [
              { x: x1 + ((x2 - x1) * i) / 8, y: y1 + ((y2 - y1) * i) / 8 },
            ],
          });
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
      };
      const paper = await page.locator(".sheet").boundingBox();
      await drag(
        paper.x + 700,
        paper.y + paper.height - 25,
        paper.x + 250,
        paper.y + paper.height - 25,
      );
      assert(
        (await page.locator(".sheet").evaluate((el) => el.scrollLeft)) > 100,
      );
      await page.locator(".sheet").evaluate((el) => (el.scrollLeft = 0));
      await page.getByLabel("重复工具", { exact: true }).tap();
      const from = await page
        .locator('.sheet-host [data-measure="2"]')
        .first()
        .boundingBox();
      const to = await page
        .locator('.sheet-host [data-measure="3"]')
        .first()
        .boundingBox();
      await drag(
        from.x + from.width / 2,
        from.y + from.height / 2,
        to.x + to.width / 2,
        to.y + to.height / 2,
      );
      assert.equal(
        await page
          .locator('.score-loop-range[data-from="2"][data-to="3"]')
          .count(),
        1,
      );
      await page.getByLabel("重复工具", { exact: true }).tap();
      assert.equal(await page.locator(".score-loop-range").count(), 0);
      await drag(
        paper.x + 700,
        paper.y + paper.height - 25,
        paper.x + 250,
        paper.y + paper.height - 25,
      );
      assert(
        (await page.locator(".sheet").evaluate((el) => el.scrollLeft)) > 100,
        "关闭循环后恢复平移",
      );
      await page.locator(".sheet").evaluate((el) => (el.scrollLeft = 0));
      const beforeSeek = await page
        .locator(".score-playhead")
        .evaluate((el) => el.style.left);
      await page.locator('.sheet-host [data-measure="3"]').first().tap();
      await page.waitForTimeout(200);
      assert.notEqual(
        await page.locator(".score-playhead").evaluate((el) => el.style.left),
        beforeSeek,
        "关闭循环后恢复单击定位",
      );
    }
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.waitForTimeout(700);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(artifacts, `网页竖屏-${name}.png`),
    });
    await page.getByRole("button", { name: "曲库", exact: true }).tap();
    await openFixture(
      page,
      "网页测试.musicxml",
      Buffer.from(
        '<score-partwise version="4.0"><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>3</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note><note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><staff>1</staff></note><backup><duration>3</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>3</duration><staff>2</staff></note></measure></part></score-partwise>',
      ),
    );
    await page.getByTitle("更多设置", { exact: true }).tap();
    await page.getByRole("tab", { name: "设备", exact: true }).tap();
    await page.getByRole("button", { name: "连接钢琴", exact: true }).tap();
    await page.getByLabel("MIDI 输入").selectOption("test-in");
    await page.getByRole("tab", { name: "练习", exact: true }).tap();
    await page.getByLabel("练习双手", { exact: true }).selectOption("right");
    await page.locator(".panel-heading button").tap();
    await page.evaluate(() => (window.sent = []));
    await page.getByRole("button", { name: "开始", exact: true }).tap();
    await page.waitForTimeout(100);
    await page.evaluate(() => {
      for (const midi of [60, 62, 64]) {
        window.note(midi, 80);
        window.note(midi, 0);
      }
    });
    await page.locator(".result-score").waitFor();
    assert((await page.locator(".result-score").textContent()).includes("100"));
    assert.equal(
      await page.evaluate(
        () =>
          window.sent.filter((data) => (data[0] & 0xf0) === 0x90 && data[2] > 0)
            .length,
      ),
      0,
      "单手自由跟弹不自动输出另一只手或回放输入",
    );
    await page.getByRole("button", { name: "完成", exact: true }).tap();
    await page.waitForTimeout(600);
    await page.reload();
    await page
      .getByText(`${catalogueCount + 1} 首本地曲目`, { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "练习记录", exact: false })
      .first()
      .tap();
    await page.locator(".history-row").first().waitFor();
    await page.locator(".panel-heading button").tap();
    if (name === "chromium") {
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await context.setOffline(true);
      await page.reload();
      await page
        .getByText(`${catalogueCount + 1} 首本地曲目`, { exact: true })
        .waitFor();
      await page
        .locator(".music-card")
        .filter({ hasText: "网页测试" })
        .click({ position: { x: 8, y: 8 } });
      await page.locator(".sheet-host svg").first().waitFor();
    }
    assert.deepEqual(errors, []);
    return {
      engine: name,
      passed: true,
      checks: [
        "横竖屏无横向溢出",
        "触摸进入曲目",
        ...(name === "chromium"
          ? ["真实触摸拖选谱面2至3小节循环，关闭后恢复平移与定位"]
          : []),
        "移除进度条、谱面垂直居中",
        "用户点击后请求MIDI",
        "真实解析的本地fixture与100%评分",
        "单手自由跟弹无软件 NoteOn 输出",
        "IndexedDB记录与曲库重载",
        ...(name === "chromium" ? ["断网重载与谱面缓存"] : []),
      ],
    };
  } catch (e) {
    await page.screenshot({
      path: path.join(artifacts, `web-failure-${name}-${Date.now()}.png`),
    });
    throw e;
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
    path.join(artifacts, "web-smoke.json"),
    JSON.stringify(
      { simulatedTablet: true, realIPadMidiTested: false, reports },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(reports, null, 2));
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
