const path = require("node:path"),
  fs = require("node:fs/promises"),
  assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { openFixture } = require("./browser-fixture.cjs");
const base = process.env.QINXI_WEB_URL || "http://localhost:4173",
  artifacts = path.resolve(__dirname, "../test-results");

async function toolbarPositionIs(page, position) {
  assert.equal(
    await page.locator(".app").getAttribute("data-toolbar-position"),
    position,
  );
  assert.equal(await page.locator(".practice-focus > header").count(), 1);
  const geometry = await page.locator(".practice-focus").evaluate((app) => {
    const header = app.querySelector(":scope > header").getBoundingClientRect();
    const main = app.querySelector(":scope > main").getBoundingClientRect();
    return {
      headerTop: header.top,
      headerBottom: header.bottom,
      mainTop: main.top,
      mainBottom: main.bottom,
      height: window.innerHeight,
    };
  });
  assert(
    geometry.headerTop >= -1 && geometry.headerBottom <= geometry.height + 1,
    `工具栏超出可视区域：${JSON.stringify(geometry)}`,
  );
  assert(
    position === "top"
      ? geometry.headerBottom <= geometry.mainTop + 1
      : geometry.headerTop >= geometry.mainBottom - 1,
    `工具栏实际位置与设置不符：${JSON.stringify({ position, geometry })}`,
  );
}

async function setToolbarPosition(page, position) {
  await page.getByTitle("更多设置", { exact: true }).tap();
  await page.getByRole("tab", { name: "显示", exact: true }).tap();
  await page.getByLabel("工具栏位置", { exact: true }).selectOption(position);
  await page.locator(".settings-panel .panel-heading button").tap();
  await toolbarPositionIs(page, position);
}

async function centerIsTouchable(control) {
  const hit = await control.evaluate((el) => {
    const rect = el.getBoundingClientRect();
    return el.contains(
      document.elementFromPoint(
        rect.x + rect.width / 2,
        rect.y + rect.height / 2,
      ),
    );
  });
  assert(
    hit,
    `控件中心无法触摸：${(await control.getAttribute("aria-label")) || (await control.getAttribute("title"))}`,
  );
}

async function keyboardFitsViewport(page) {
  const geometry = await page.locator(".upstream-keys").evaluate((keys) => {
    const key = keys.getBoundingClientRect();
    const host = keys.closest(".roll-keyboard").getBoundingClientRect();
    const header = document
      .querySelector(".practice-focus > header")
      .getBoundingClientRect();
    return {
      top: key.top,
      bottom: key.bottom,
      height: key.height,
      visibleWidth:
        Math.min(key.right, host.right, innerWidth) -
        Math.max(key.left, host.left, 0),
      viewportHeight: innerHeight,
      headerTop: header.top,
      headerBottom: header.bottom,
    };
  });
  assert(
    geometry.height >= 70 && geometry.visibleWidth > 0,
    `手机键盘没有足够可见区域：${JSON.stringify(geometry)}`,
  );
  assert(
    geometry.top >= -1 && geometry.bottom <= geometry.viewportHeight + 1,
    `手机键盘上下被视口裁切：${JSON.stringify(geometry)}`,
  );
  assert(
    geometry.bottom <= geometry.headerTop + 1 ||
      geometry.top >= geometry.headerBottom - 1,
    `手机键盘与工具栏相交：${JSON.stringify(geometry)}`,
  );
  return geometry;
}

async function compactToolbar(page, position, viewport, expectedTitle) {
  await page.setViewportSize(viewport);
  await page.waitForTimeout(100);
  await toolbarPositionIs(page, position);
  assert.equal(await page.locator(".song-name").textContent(), expectedTitle);
  const geometry = await page.locator(".song-name").evaluate((title) => {
    const style = getComputedStyle(title),
      toolbar = title.closest("header").querySelector(".toolbar");
    return {
      headerHeight: title.closest("header").getBoundingClientRect().height,
      titleHeight: title.getBoundingClientRect().height,
      lineHeight:
        parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.5,
      nowrap: style.whiteSpace === "nowrap",
      ellipsis: style.textOverflow === "ellipsis",
      truncated: title.clientWidth > 0 && title.scrollWidth > title.clientWidth,
      pageWidth: Math.max(
        document.documentElement.scrollWidth,
        document.body.scrollWidth,
      ),
      viewportWidth: innerWidth,
      scrollable: ["auto", "scroll"].includes(
        getComputedStyle(toolbar).overflowX,
      ),
      overflowing: toolbar.scrollWidth > toolbar.clientWidth,
    };
  });
  const maxHeight = viewport.width > viewport.height ? 58 : 110;
  assert(
    geometry.headerHeight <= maxHeight,
    `手机工具栏过高：${JSON.stringify({ position, viewport, geometry })}`,
  );
  assert(
    geometry.nowrap &&
      geometry.ellipsis &&
      geometry.titleHeight <= geometry.lineHeight + 1,
    `手机长曲名没有单行省略：${JSON.stringify(geometry)}`,
  );
  assert(
    geometry.pageWidth <= geometry.viewportWidth + 1,
    "手机页面发生整页水平溢出",
  );
  assert(geometry.scrollable, "手机工具栏不能在空间不足时横向滚动");
  const keyboard = await keyboardFitsViewport(page);
  const toolbar = page.locator(".practice-focus > header .toolbar");
  await toolbar.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const play = page.locator(".playback-toggle");
  const settings = page.getByTitle("更多设置", { exact: true });
  await centerIsTouchable(play);
  await centerIsTouchable(settings);
  await play.tap();
  await page.getByRole("button", { name: "暂停", exact: true }).tap();
  await settings.tap();
  await page.locator(".settings-panel").waitFor();
  await page.locator(".settings-panel .panel-heading button").tap();
  const tools = [
    toolbar.getByLabel("练习模式", { exact: true }),
    toolbar.getByLabel("速度", { exact: true }),
    toolbar.getByRole("button", { name: "节拍器", exact: true }),
    toolbar.getByTitle("回到第一小节", { exact: true }),
    toolbar.getByLabel("重复工具", { exact: true }),
    toolbar.getByTitle("全屏 / Esc 退出", { exact: true }),
  ];
  for (const tool of tools) {
    assert.equal(await tool.count(), 1, "手机工具栏缺少现有工具");
    await tool.scrollIntoViewIfNeeded();
    await centerIsTouchable(tool);
  }
  if (geometry.overflowing)
    assert(
      await toolbar.evaluate((el) => el.scrollLeft > 0),
      "访问其余工具时没有发生横向滚动",
    );
  const speed = toolbar.getByLabel("速度", { exact: true });
  await speed.scrollIntoViewIfNeeded();
  const previousSpeed = await speed.inputValue(),
    box = await speed.boundingBox();
  await page.touchscreen.tap(
    box.x + box.width * (Number(previousSpeed) < 100 ? 0.85 : 0.15),
    box.y + box.height / 2,
  );
  assert.notEqual(
    await speed.inputValue(),
    previousSpeed,
    "横向滚动后的速度滑条没有响应",
  );
  await toolbar.evaluate((el) => {
    el.scrollLeft = 0;
  });
  const checkFree = position === "top" && viewport.width === 844;
  if (checkFree) {
    const mode = toolbar.getByLabel("练习模式", { exact: true });
    await mode.selectOption("free");
    await page.locator(".free-play[data-visible-whites]").waitFor();
    const clear = toolbar.getByRole("button", { name: "清空", exact: true });
    await clear.scrollIntoViewIfNeeded();
    await centerIsTouchable(clear);
    assert.equal((await clear.textContent()).trim(), "清空");
    assert(
      await clear.evaluate(
        (el) => parseFloat(getComputedStyle(el).fontSize) >= 12,
      ),
      "自由练习清空按钮的文字被隐藏",
    );
    await clear.tap();
    await keyboardFitsViewport(page);
    await mode.selectOption("wait");
    await page.getByLabel("下落音符", { exact: true }).waitFor();
    await toolbar.evaluate((el) => {
      el.scrollLeft = 0;
    });
  }
  return {
    position,
    ...viewport,
    headerHeight: geometry.headerHeight,
    keyboardHeight: keyboard.height,
    freeModeChecked: checkFree,
  };
}

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
    await openFixture(
      page,
      "完整曲名检查.musicxml",
      Buffer.from(
        `<score-partwise version="4.0"><work><work-title>${longTitle}</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration></note></measure></part></score-partwise>`,
      ),
    );
    await page.locator(".sheet-host svg").first().waitFor();
    console.log(name, "score ready");
    await toolbarPositionIs(page, "top");
    const tested = [];
    for (const position of ["top", "bottom"]) {
      if (position === "bottom") await setToolbarPosition(page, position);
      for (const viewport of [
        { width: 1024, height: 700 },
        { width: 1024, height: 768 },
        { width: 768, height: 1024 },
        { width: 1194, height: 834 },
      ]) {
        await page.setViewportSize(viewport);
        console.log(name, "viewport", viewport);
        await page.waitForTimeout(100);
        await toolbarPositionIs(page, position);
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
        const speedBox = await tempo.boundingBox();
        await page.touchscreen.tap(
          speedBox.x + speedBox.width * 0.25,
          speedBox.y + speedBox.height / 2,
        );
        assert.notEqual(
          await tempo.inputValue(),
          "150",
          "触摸速度滑条没有响应",
        );
        const hits = await page
          .locator(
            '.practice-focus > header button, .practice-focus > header select, .practice-focus > header input[type="range"]',
          )
          .evaluateAll((controls) =>
            controls.map((control) => {
              const rect = control.getBoundingClientRect(),
                hit = document.elementFromPoint(
                  rect.x + rect.width / 2,
                  rect.y + rect.height / 2,
                );
              return {
                label:
                  control.getAttribute("aria-label") ||
                  control.title ||
                  control.textContent.trim(),
                hit: control.contains(hit),
              };
            }),
          );
        assert(
          hits.every((entry) => entry.hit),
          JSON.stringify({ position, viewport, hits }),
        );
        await page.getByTitle("更多设置", { exact: true }).tap();
        await page.locator(".panel-heading").waitFor();
        await page.locator(".panel-heading button").tap();
        const metronome = page.getByRole("button", {
          name: "节拍器",
          exact: true,
        });
        const previousMetronome = await metronome.getAttribute("aria-pressed");
        await metronome.tap();
        assert.notEqual(
          await metronome.getAttribute("aria-pressed"),
          previousMetronome,
        );
        await metronome.tap();
        assert.equal(
          await metronome.getAttribute("aria-pressed"),
          previousMetronome,
        );
        const loop = page.getByLabel("重复工具", { exact: true });
        await loop.tap();
        assert.equal(await loop.getAttribute("aria-pressed"), "true");
        await loop.tap();
        await page.getByRole("button", { name: "开始", exact: true }).tap();
        console.log(name, "started");
        await page.getByRole("button", { name: "暂停", exact: true }).tap();
        await page.getByTitle("回到第一小节", { exact: true }).tap();
        await page.getByRole("button", { name: "开始", exact: true }).waitFor();
        tested.push({ position, ...viewport });
      }
    }
    const compact = [];
    for (const position of ["top", "bottom"]) {
      await setToolbarPosition(page, position);
      for (const viewport of [
        { width: 320, height: 568 },
        { width: 390, height: 844 },
        { width: 430, height: 932 },
        { width: 844, height: 390 },
      ])
        compact.push(await compactToolbar(page, position, viewport, longTitle));
    }
    await page.setViewportSize({ width: 1194, height: 834 });
    await toolbarPositionIs(page, "bottom");
    await page.getByRole("button", { name: "开始", exact: true }).tap();
    await setToolbarPosition(page, "top");
    await page.getByRole("button", { name: "暂停", exact: true }).waitFor();
    await setToolbarPosition(page, "bottom");
    await page.getByRole("button", { name: "暂停", exact: true }).tap();
    for (const practiceMode of ["wait", "free", "rhythm", "listen"]) {
      await page
        .getByLabel("练习模式", { exact: true })
        .selectOption(practiceMode);
      await toolbarPositionIs(page, "bottom");
    }
    await page.screenshot({
      path: path.join(artifacts, `toolbar-bottom-${name}.png`),
    });
    await page.getByRole("button", { name: "曲库", exact: true }).tap();
    await page.locator(".library-home").waitFor();
    await page
      .locator(".music-card")
      .filter({ hasText: "欢乐颂" })
      .first()
      .tap();
    await page.locator(".sheet-host svg").first().waitFor();
    await toolbarPositionIs(page, "bottom");
    await page.reload();
    await page.locator(".music-card").first().waitFor();
    assert.equal(
      await page.locator(".app").getAttribute("data-toolbar-position"),
      "bottom",
    );
    await page
      .locator(".music-card")
      .filter({ hasText: "欢乐颂" })
      .first()
      .tap();
    await page.locator(".sheet-host svg").first().waitFor();
    await toolbarPositionIs(page, "bottom");
    await setToolbarPosition(page, "top");
    await page.screenshot({
      path: path.join(artifacts, `toolbar-top-${name}.png`),
    });
    await page.getByRole("button", { name: "曲库", exact: true }).tap();
    await page.locator(".library-home").waitFor();
    return {
      engine: name,
      passed: true,
      simulatedViewportChanges: tested,
      compactPhoneViewports: compact,
      globalBottomPreferencePersists: ["四种模式", "切换曲目", "重新加载"],
    };
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
          "顶部与底部工具栏在四种视口均可触摸按钮、模式及速度控件",
          "底部位置是全局偏好，切换四种模式、曲目和重新加载均保留，可切回顶部",
          "调整视口后触控设置、重复、开始、暂停、重来及返回",
          "无进度条，长曲名在横竖屏完整显示且顶栏无溢出",
          "手机长曲名单行省略、工具栏高度受限，播放/设置直接触摸，其他工具横向滚动访问",
          "手机键盘上下完整且不覆盖工具栏，自由练习清空按钮保留可见文字",
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
