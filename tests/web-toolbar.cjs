const path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173",
  artifacts = path.resolve(__dirname, "../test-results");

async function run(engine, name) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1024, height: 700 },
    hasTouch: true,
    isMobile: true,
  });
  await context.addInitScript(() => {
    const input = {
      id: "test-in",
      name: "QA FP-30X",
      state: "connected",
      type: "input",
    };
    Object.defineProperty(navigator, "requestMIDIAccess", {
      value: async () => ({
        inputs: new Map([[input.id, input]]),
        outputs: new Map(),
      }),
    });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  try {
    await page.goto(base);
    await page.locator(".music-card").first().waitFor();
    console.log(name, "library ready");
    await page.getByLabel("搜索曲库").focus();
    const focusStyle = await page.getByLabel("搜索曲库").evaluate((el) => {
      const style = getComputedStyle(el);
      return {
        outline: style.outlineStyle,
        shadow: style.boxShadow,
        border: style.borderWidth,
      };
    });
    assert.deepEqual(focusStyle, {
      outline: "none",
      shadow: "none",
      border: "0px",
    });
    await page.locator(".home-device").tap();
    await page
      .locator(".settings-panel")
      .getByRole("button", { name: "连接钢琴", exact: true })
      .tap();
    await page.getByLabel("MIDI 输入").selectOption("test-in");
    console.log(name, "MIDI connected");
    await page.locator(".panel-heading button").tap();
    const longTitle =
      "用于检查完整曲名显示的双手练习曲（标题换行后仍应完整可见）";
    await page.locator("#file-input").setInputFiles({
      name: "完整曲名检查.musicxml",
      mimeType: "application/xml",
      buffer: Buffer.from(
        `<score-partwise version="4.0"><work><work-title>${longTitle}</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`,
      ),
    });
    await page.getByRole("button", { name: "加入曲库", exact: true }).tap();
    await page.locator(".sheet-host svg").first().waitFor();
    console.log(name, "score ready");
    const tested = [];
    for (const viewport of [
      { width: 1024, height: 700 },
      { width: 1024, height: 768 },
      { width: 768, height: 1024 },
      { width: 1194, height: 834 },
    ]) {
      await page.setViewportSize(viewport);
      console.log(name, "viewport", viewport);
      await page.waitForTimeout(100);
      assert.equal(await page.locator(".timeline").count(), 0);
      assert.equal(
        await page
          .locator(".sheet")
          .evaluate((el) => el.nextElementSibling.className),
        "resize",
      );
      assert.equal(await page.locator(".song-name").textContent(), longTitle);
      const titleFit = await page.locator(".song-name").evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const text = range.getBoundingClientRect(),
          button = el.closest("button").getBoundingClientRect(),
          header = el.closest("header");
        return {
          clipped:
            text.left < button.left - 1 ||
            text.right > button.right + 1 ||
            text.top < button.top - 1 ||
            text.bottom > button.bottom + 1,
          ellipsis: getComputedStyle(el).textOverflow === "ellipsis",
          overflow: header.scrollWidth > header.clientWidth + 1,
        };
      });
      assert.deepEqual(titleFit, {
        clipped: false,
        ellipsis: false,
        overflow: false,
      });
      const fontSizes = await page
        .locator(
          "header .back-library, header .song-button, .toolbar-speed, .toolbar-speed input, .tempo-reading, .toolbar > .primary",
        )
        .evaluateAll((els) => els.map((el) => getComputedStyle(el).fontSize));
      assert.equal(new Set(fontSizes).size, 1, JSON.stringify(fontSizes));
      const tempo = page.getByLabel("速度", { exact: true });
      await tempo.press("Home");
      assert.equal(await tempo.inputValue(), "25");
      await tempo.press("ArrowRight");
      assert.equal(await tempo.inputValue(), "26");
      await tempo.press("End");
      assert.equal(await tempo.inputValue(), "150");
      assert.match(await tempo.getAttribute("aria-valuetext"), /^\d+ BPM$/);
      const hits = await page
        .locator(".practice-focus > header button")
        .evaluateAll((buttons) =>
          buttons.map((button) => {
            const rect = button.getBoundingClientRect(),
              hit = document.elementFromPoint(
                rect.x + rect.width / 2,
                rect.y + rect.height / 2,
              );
            return {
              label: button.title || button.textContent.trim(),
              hit: button.contains(hit),
            };
          }),
        );
      assert(
        hits.every((entry) => entry.hit),
        JSON.stringify({ viewport, hits }),
      );
      await page.getByTitle("更多设置", { exact: true }).tap();
      await page.locator(".panel-heading").waitFor();
      await page.locator(".panel-heading button").tap();
      const loop = page.getByLabel("重复工具", { exact: true });
      await loop.tap();
      assert.equal(await loop.getAttribute("aria-pressed"), "true");
      await loop.tap();
      await page.getByRole("button", { name: "开始", exact: true }).tap();
      console.log(name, "started");
      await page.getByRole("button", { name: "暂停", exact: true }).tap();
      await page.getByTitle("从头重来", { exact: true }).tap();
      await page.getByRole("button", { name: "开始", exact: true }).waitFor();
      tested.push(viewport);
    }
    await page.getByRole("button", { name: "曲库", exact: true }).tap();
    await page.locator(".library-home").waitFor();
    return { engine: name, passed: true, simulatedViewportChanges: tested };
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
    path.join(artifacts, "toolbar-smoke.json"),
    JSON.stringify(
      {
        realIPadMidiWebTested: false,
        checks: [
          "工具栏按钮中心未被页面覆盖",
          "调整视口后触控设置、重复、开始、暂停、重来及返回",
          "无进度条，长曲名在横竖屏完整显示且顶栏无溢出",
          "搜索焦点无额外内框",
        ],
        reports,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify(reports, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
