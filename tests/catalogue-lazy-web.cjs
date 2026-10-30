const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { Midi } = require("@tonejs/midi");
const { chromium, webkit } = require("playwright");
const { parseLocalScore } = require("../scripts/import-scores.cjs");

const base = process.env.QINXI_WEB_URL || "http://localhost:4173/";
const root = path.resolve(__dirname, "..");
const artifacts = path.join(root, "test-results");
const prefix = "qa-lazy-";
const titleA = "按需测试 A";
const titleB = "按需测试 B";
const titleC = "按需测试 C";
const titleD = "按需测试 D";
const oneBarXml = `<score-partwise version="4.0"><work><work-title>${titleA}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff><notations><technical><fingering>1</fingering></technical></notations></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff><notations><technical><fingering>3</fingering></technical></notations></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff><notations><technical><fingering>5</fingering></technical></notations></note><note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff><notations><technical><fingering>1</fingering></technical></notations></note></measure></part></score-partwise>`;
const oneBar = oneBarXml.match(/<measure[\s\S]*?<\/measure>/)[0];
const nativeXml = oneBarXml.replace(
  oneBar,
  [1, 2, 3]
    .map((number) => oneBar.replace('number="1"', `number="${number}"`))
    .join(""),
);
const xmlBytes = Buffer.from(nativeXml);
const midi = new Midi();
midi.addTrack().addNote({ midi: 60, time: 0, duration: 0.5 });
midi.addTrack().addNote({ midi: 48, time: 0, duration: 0.5 });
const midiBytes = Buffer.from(midi.toArray());
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const entries = Array.from({ length: 516 }, (_, index) => ({
  id: `${prefix}${index}`,
  title: [titleA, titleB, titleC, titleD][index] || `未点击曲目 ${index}`,
  file: `${prefix}${index}.${index ? "mid" : "musicxml"}`,
  sha256: sha(index ? midiBytes : xmlBytes),
  composer: "自动检查",
  category: "按需测试",
  difficulty: "入门",
  focus: "测试数据",
  license: "测试夹具",
  attribution: "自动检查",
  sourceUrl: "",
  edition: "按需加载测试",
}));
const fileA = entries[0].file;
const fileB = entries[1].file;
const fileC = entries[2].file;
const fileD = entries[3].file;

async function readyHome(page, count) {
  await page.locator(".library-home").waitFor();
  await page.getByText(`${count} 首本地曲目`, { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".app")?.getAttribute("aria-busy") === "false",
  );
}
async function readyScore(page, title) {
  await page.waitForFunction(
    (expected) =>
      document.querySelector(".song-name")?.textContent === expected &&
      document.querySelector(".app")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector(".sheet-loading") &&
      !!document.querySelector('.sheet-host[aria-busy="false"] svg'),
    title,
  );
  await page.locator(".upstream-keys[aria-description]").waitFor();
}
const card = (page, title) =>
  page.locator(".music-card").filter({ hasText: title }).first();
const returnHome = (page) =>
  page.getByRole("button", { name: "曲库", exact: true }).click();

// Poll resolved snapshots in Node, not async predicates in waitForFunction.
async function stored(page) {
  return page.evaluate(
    ({ prefix, idA, idB, idC }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("qinxi-piano", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const read = db
            .transaction("data")
            .objectStore("data")
            .get("library");
          read.onerror = () => {
            db.close();
            reject(read.error);
          };
          read.onsuccess = () => {
            const value = read.result;
            db.close();
            if (!value) return resolve(null);
            if (value.encoding)
              return reject(Error("纯元数据夹具不应达到大库存储阈值"));
            const songs = value.songs;
            resolve({
              bytes: new Blob([JSON.stringify(value)]).size,
              songCount: songs.length,
              loadedIds: songs
                .filter((song) => song.notes.length > 0 || song.xml)
                .map((song) => song.id),
              untouched: songs
                .filter(
                  (song) =>
                    song.id.startsWith(prefix) &&
                    song.id !== idA &&
                    song.id !== idC,
                )
                .every(
                  (song) =>
                    !song.notes.length &&
                    !song.xml &&
                    !song.catalogue?.revision,
                ),
              lastSong: value.lastSong,
              a: songs.find((song) => song.id === idA),
              b: songs.find((song) => song.id === idB),
              c: songs.find((song) => song.id === idC),
              settingsA: value.settings[idA],
            });
          };
        };
      }),
    { prefix, idA: entries[0].id, idB: entries[1].id, idC: entries[2].id },
  );
}
async function waitForStored(page, predicate) {
  const deadline = Date.now() + 25000;
  let snapshot;
  do {
    snapshot = await stored(page);
    if (snapshot && predicate(snapshot)) return snapshot;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw Error(
    `保存状态未满足预期：${JSON.stringify({ count: snapshot?.songCount, loaded: snapshot?.loadedIds, last: snapshot?.lastSong })}`,
  );
}

async function run(engine, name, expectedCount) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1180, height: 820 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    sourceRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  let failManifest = false,
    failD = false,
    cancelledB = false;
  let releaseB, startedB;
  const pendingB = new Promise((resolve) => {
    releaseB = resolve;
  });
  const bStarted = new Promise((resolve) => {
    startedB = resolve;
  });
  await context.route("**/catalogue/**", async (route) => {
    const filename = decodeURIComponent(new URL(route.request().url()).pathname)
      .split("/")
      .at(-1);
    if (filename === "manifest.json") {
      await route.fulfill({
        status: failManifest ? 503 : 200,
        contentType: "application/json",
        body: JSON.stringify(
          failManifest ? { error: "fixture unavailable" } : entries,
        ),
      });
      return;
    }
    sourceRequests.push(filename);
    if (!filename.startsWith(prefix)) return route.continue();
    if (filename === fileB) {
      startedB();
      await pendingB;
    }
    try {
      await route.fulfill({
        status: filename === fileD && failD ? 404 : 200,
        contentType: filename === fileA ? "application/xml" : "audio/midi",
        body: filename === fileA ? xmlBytes : midiBytes,
      });
    } catch (error) {
      if (!(filename === fileB && cancelledB)) throw error;
    }
  });
  try {
    const coldStarted = Date.now();
    await page.goto(base);
    await readyHome(page, expectedCount);
    const coldReadyMs = Date.now() - coldStarted;
    const cold = await waitForStored(
      page,
      (value) => value.songCount === expectedCount,
    );
    assert.equal(sourceRequests.length, 0, "首次列表提前读取了曲谱文件");
    assert.deepEqual(cold.loadedIds, []);
    assert(cold.untouched);
    await page.screenshot({
      path: path.join(artifacts, `按需曲库列表-${name}.png`),
    });

    // Display/device preferences can be saved before this metadata-only song opens.
    const placeholderSettings = {
      minWhiteKeys: 35,
      registerMode: "lock",
      speed: 55,
      hand: "both",
      mode: "rhythm",
      from: 1,
      to: 1,
      loop: true,
      startBeat: 0.5,
      metronome: false,
      backing: false,
      split: 60,
      sheetHeight: 40,
      inputId: "",
      outputId: "",
    };
    await page.evaluate(
      ({ id, settings }) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("qinxi-piano", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("data", "readwrite");
            const store = transaction.objectStore("data");
            const read = store.get("library");
            read.onsuccess = () =>
              store.put(
                {
                  ...read.result,
                  lastSong: id,
                  settings: { ...read.result.settings, [id]: settings },
                },
                "library",
              );
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
      { id: entries[0].id, settings: placeholderSettings },
    );
    await page.reload();
    await readyHome(page, expectedCount);
    assert.equal(
      sourceRequests.length,
      0,
      "保存未打开曲目设置后刷新提前读取了谱面",
    );

    await card(page, titleA).click();
    await readyScore(page, titleA);
    assert.deepEqual(sourceRequests, [fileA], "点击A读取了其他曲谱");
    const firstOpened = await waitForStored(
      page,
      (value) => value.a?.notes.length === 12,
    );
    assert.equal(firstOpened.settingsA.from, 1);
    assert.equal(
      firstOpened.settingsA.to,
      3,
      "首次打开被元数据占位的小节1设置截断",
    );
    assert.equal(firstOpened.settingsA.loop, false);
    assert.equal(firstOpened.settingsA.startBeat, undefined);
    assert.equal(firstOpened.settingsA.mode, placeholderSettings.mode);
    assert.equal(firstOpened.settingsA.speed, placeholderSettings.speed);
    assert.equal(
      firstOpened.settingsA.sheetHeight,
      placeholderSettings.sheetHeight,
    );
    assert.equal(
      firstOpened.settingsA.minWhiteKeys,
      placeholderSettings.minWhiteKeys,
    );
    assert.equal(
      firstOpened.settingsA.registerMode,
      placeholderSettings.registerMode,
    );
    await page.getByTitle("更多设置", { exact: true }).click();
    await page.getByRole("tab", { name: "显示", exact: true }).click();
    await page
      .locator("#settings-display summary")
      .filter({ hasText: "声部分配" })
      .click();
    await page
      .locator("#settings-display .track select")
      .first()
      .selectOption("right");
    await page.getByRole("tab", { name: "练习", exact: true }).click();
    await page.getByLabel("起始小节", { exact: true }).fill("2");
    await page.getByLabel("结束小节", { exact: true }).fill("3");
    await page.getByLabel("循环练习", { exact: true }).check();
    await page.locator(".settings-panel .panel-heading button").click();
    await page.getByLabel("练习模式", { exact: true }).selectOption("rhythm");
    const original = await waitForStored(
      page,
      (value) =>
        value.a?.notes.length === 12 &&
        value.a.tracks[0].role === "right" &&
        value.settingsA?.mode === "rhythm" &&
        value.settingsA.from === 2 &&
        value.settingsA.to === 3 &&
        value.settingsA.loop,
    );
    assert.equal(original.a.xml, nativeXml);
    assert(
      original.a.notes.every((note) => note.finger >= 1 && note.finger <= 5),
    );
    assert.deepEqual(original.loadedIds, [entries[0].id]);
    assert(original.untouched);
    await returnHome(page);
    await card(page, titleA).click();
    await readyScore(page, titleA);
    assert.deepEqual(sourceRequests, [fileA], "同页再次进入A又请求了文件");
    await returnHome(page);

    const beforeWarm = sourceRequests.length;
    const warmStarted = Date.now();
    await page.reload();
    await readyHome(page, expectedCount);
    const warmReadyMs = Date.now() - warmStarted;
    assert.equal(sourceRequests.length, beforeWarm, "刷新列表重新请求了曲谱");
    await card(page, titleA).click();
    await readyScore(page, titleA);
    assert.equal(
      sourceRequests.length,
      beforeWarm,
      "刷新后点击A没有复用已保存解析结果",
    );
    const warm = await waitForStored(
      page,
      (value) => value.lastSong === entries[0].id,
    );
    assert.deepEqual(warm.a.notes, original.a.notes);
    assert.equal(warm.a.xml, original.a.xml);
    assert.deepEqual(warm.a.tracks, original.a.tracks);
    assert.deepEqual(warm.settingsA, original.settingsA);
    assert.equal(
      await page.getByLabel("练习模式", { exact: true }).inputValue(),
      "rhythm",
    );
    await page.screenshot({
      path: path.join(artifacts, `按需曲库缓存-${name}.png`),
    });
    await returnHome(page);

    await card(page, titleB).click();
    await Promise.race([
      bStarted,
      page.waitForTimeout(10000).then(() => {
        throw Error("点击B后没有发出对应曲谱请求");
      }),
    ]);
    await page.locator("main .sheet-loading").waitFor();
    cancelledB = true;
    await returnHome(page);
    await card(page, titleC).click();
    await readyScore(page, titleC);
    releaseB();
    await page.waitForTimeout(200);
    assert.equal(
      await page.locator(".song-name").textContent(),
      titleC,
      "晚到的B覆盖了最新选择C",
    );
    const afterCancel = await waitForStored(
      page,
      (value) => value.lastSong === entries[2].id && value.c?.notes.length > 0,
    );
    assert.equal(afterCancel.b.notes.length, 0);
    assert.equal(afterCancel.b.xml, "");
    assert.equal(afterCancel.b.catalogue.revision, undefined);
    assert.deepEqual(
      afterCancel.loadedIds.sort(),
      [entries[0].id, entries[2].id].sort(),
    );
    assert.deepEqual(afterCancel.a.notes, original.a.notes);
    assert.equal(sourceRequests.filter((file) => file === fileB).length, 1);
    assert.equal(sourceRequests.filter((file) => file === fileC).length, 1);
    await returnHome(page);

    failManifest = true;
    const beforeFailure = sourceRequests.length;
    await page.reload();
    await readyHome(page, expectedCount);
    assert.equal(sourceRequests.length, beforeFailure);
    await card(page, titleA).click();
    await readyScore(page, titleA);
    assert.equal(
      sourceRequests.length,
      beforeFailure,
      "索引暂不可用时没有复用已缓存A",
    );
    await returnHome(page);
    failD = true;
    await card(page, titleD).click();
    await page.locator(".banner.error").filter({ hasText: titleD }).waitFor();
    await readyHome(page, expectedCount);
    const afterFailure = await waitForStored(
      page,
      (value) => value.lastSong === entries[0].id,
    );
    assert.equal(afterFailure.songCount, expectedCount);
    assert.deepEqual(afterFailure.a.notes, original.a.notes);
    assert.equal(afterFailure.a.xml, original.a.xml);
    assert.equal(sourceRequests.filter((file) => file === fileD).length, 1);
    assert.deepEqual(
      afterFailure.loadedIds.sort(),
      [entries[0].id, entries[2].id].sort(),
    );
    assert.deepEqual(errors, []);
    return {
      engine: name,
      passed: true,
      serviceWorkersBlocked: true,
      metadataSongs: expectedCount,
      coldListReadyMs: coldReadyMs,
      warmListReadyMs: warmReadyMs,
      metadataCacheBytes: cold.bytes,
      initialSourceRequests: 0,
      sourceRequests,
      firstAndRepeatedARequests: sourceRequests.filter((file) => file === fileA)
        .length,
      cachedNotesXmlFingersRolesAndSettingsPreserved: true,
      firstOpenReplacesPlaceholderRangeWithFullScore: true,
      firstOpenPreservesModeSpeedAndDisplay: true,
      existingLoopRangePreservedAfterReload: true,
      delayedBAbortedAndNotCached: true,
      latestCSelectionWins: true,
      manifestFailureKeepsExistingLibrary: true,
      individualFailureKeepsOtherSongs: true,
      pageErrors: errors,
    };
  } catch (error) {
    await page
      .screenshot({ path: path.join(artifacts, `按需曲库失败-${name}.png`) })
      .catch(() => {});
    throw error;
  } finally {
    cancelledB = true;
    releaseB();
    await context.close();
    await browser.close();
  }
}

async function legacyMigration(personalCount) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    serviceWorkers: "block",
    viewport: { width: 1180, height: 820 },
    locale: "zh-CN",
  });
  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const errors = [],
    sourceRequests = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const aId = "qa-migration-a",
    bId = "qa-migration-b";
  const removedVisitedId = "qa-migration-removed-visited";
  const removedUnvisitedId = "qa-migration-removed-unvisited";
  const localId = "qa-migration-local";
  const dailyId = "daily-migration-cached";
  const aTitle = "迁移曲目 A";
  const migrationEntries = [
    {
      ...entries[0],
      id: aId,
      title: aTitle,
      file: "qa-migration-a.mid",
      sha256: sha(midiBytes),
    },
    {
      ...entries[1],
      id: bId,
      title: "迁移曲目 B",
      file: "qa-migration-b.mid",
      sha256: sha(midiBytes),
    },
  ];
  const settings = {
    minWhiteKeys: 28,
    speed: 80,
    hand: "both",
    mode: "wait",
    loop: false,
    from: 1,
    to: 1,
    metronome: false,
    backing: false,
    split: 60,
    sheetHeight: 34,
    inputId: "",
    outputId: "",
  };
  const oldMidi = (id, title) => ({
    ...parseLocalScore(`${title}.mid`, midiBytes),
    id,
    title,
    source: "builtin",
  });
  const a = oldMidi(aId, aTitle);
  a.notes = a.notes.map((note, index) => ({ ...note, finger: index ? 5 : 3 }));
  let annotation = 0;
  a.xml = a.xml.replace(
    /(<note><pitch>[\s\S]*?)(<\/note>)/g,
    (_note, head, tail) =>
      `${head}<notations><technical><fingering>${[3, 5][annotation++]}</fingering></technical></notations>${tail}`,
  );
  assert.equal(annotation, 2);
  const b = oldMidi(bId, "迁移曲目 B");
  const removedVisited = oldMidi(removedVisitedId, "历史访问曲目");
  const removedUnvisited = oldMidi(removedUnvisitedId, "历史未访问曲目");
  const local = {
    ...parseLocalScore("本地保留曲.musicxml", xmlBytes),
    id: localId,
    title: "本地保留曲",
  };
  const daily = oldMidi(dailyId, "每日练习旧缓存");
  const results = [
    {
      id: "qa-legacy-result",
      songId: dailyId,
      title: daily.title,
      date: "2026-10-31T00:00:00.000Z",
      seconds: 12,
      correct: 2,
      wrong: 0,
      missed: 0,
      accuracy: 100,
      problemMeasures: [],
      offsets: [],
      mode: "wait",
      speed: 80,
      hand: "both",
    },
  ];
  const legacy = {
    version: 1,
    collection: "piano-scores-v2",
    songs: [a, b, removedVisited, removedUnvisited, local, daily],
    settings: {
      [aId]: { ...settings, loop: true, startBeat: 0.25 },
      [removedVisitedId]: { ...settings, speed: 65 },
    },
    lastSong: aId,
    results,
    favorites: [aId, removedVisitedId],
    toolbarPosition: "top",
    showFingering: true,
  };
  assert(
    legacy.songs.every(
      (song) => !song.catalogue && song.notes.length > 0 && song.xml,
    ),
  );
  await context.route("**/catalogue/**", async (route) => {
    const filename = decodeURIComponent(new URL(route.request().url()).pathname)
      .split("/")
      .at(-1);
    if (filename === "manifest.json") {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(migrationEntries),
      });
      return;
    }
    sourceRequests.push(filename);
    if (filename.startsWith("qa-migration-")) {
      await route.fulfill({ contentType: "audio/midi", body: midiBytes });
      return;
    }
    await route.continue();
  });
  const read = () =>
    page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("qinxi-piano", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const get = db
              .transaction("data")
              .objectStore("data")
              .get("library");
            get.onerror = () => {
              db.close();
              reject(get.error);
            };
            get.onsuccess = () => {
              db.close();
              resolve(get.result);
            };
          };
        }),
    );
  async function saved(predicate) {
    const deadline = Date.now() + 25000;
    let value;
    do {
      value = await read();
      if (value && predicate(value)) return value;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    throw Error(
      `旧库迁移状态未满足预期：${JSON.stringify(value?.songs?.map((song) => [song.id, song.notes.length]))}`,
    );
  }
  try {
    await page.goto(base);
    await readyHome(page, personalCount + 2);
    await saved((value) => value.songs.length === personalCount + 2);
    await page.waitForTimeout(100);
    await page.evaluate(
      (value) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("qinxi-piano", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("data", "readwrite");
            transaction.objectStore("data").put(value, "library");
            transaction.oncomplete = () => {
              db.close();
              resolve();
            };
            transaction.onabort = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
      legacy,
    );
    await page.reload();
    const expected = personalCount + 5;
    await readyHome(page, expected);
    const migrated = await saved((value) => value.songs.length === expected);
    const byId = new Map(migrated.songs.map((song) => [song.id, song]));
    assert.deepEqual(sourceRequests, [], "旧库迁移时提前请求了源曲谱");
    assert.deepEqual(byId.get(aId).notes, a.notes);
    assert.equal(byId.get(aId).xml, a.xml);
    assert.equal(byId.get(aId).catalogue.revision, undefined);
    assert.deepEqual(byId.get(bId).notes, []);
    assert.equal(byId.get(bId).xml, "");
    assert.equal(byId.get(bId).duration, 0);
    assert.equal(byId.has(removedUnvisitedId), false);
    assert.deepEqual(byId.get(removedVisitedId).notes, removedVisited.notes);
    assert.equal(byId.get(removedVisitedId).xml, removedVisited.xml);
    assert.equal(byId.get(removedVisitedId).catalogue, undefined);
    assert.deepEqual(byId.get(localId), local);
    assert.deepEqual(byId.get(dailyId), daily);
    assert.deepEqual(migrated.results, results);
    assert.deepEqual(migrated.favorites, legacy.favorites);
    assert.deepEqual(migrated.settings[aId], legacy.settings[aId]);
    await card(page, removedVisited.title).click();
    await readyScore(page, removedVisited.title);
    assert.deepEqual(sourceRequests, [], "已移除但曾访问的曲目不能直接复用");
    await returnHome(page);
    await card(page, aTitle).click();
    await readyScore(page, aTitle);
    const loaded = await saved(
      (value) =>
        value.lastSong === aId &&
        value.songs.find((song) => song.id === aId)?.catalogue?.revision,
    );
    const loadedA = loaded.songs.find((song) => song.id === aId);
    assert.deepEqual(
      loadedA.notes.map((note) => [note.id, note.finger]),
      a.notes.map((note) => [note.id, note.finger]),
    );
    assert(
      loadedA.xml.includes("<fingering>3</fingering>") &&
        loadedA.xml.includes("<fingering>5</fingering>"),
    );
    assert.deepEqual(
      loaded.settings[aId],
      legacy.settings[aId],
      "旧已加载曲目的循环和定位设置被首次加载逻辑重置",
    );
    assert.deepEqual(sourceRequests, [migrationEntries[0].file]);
    await returnHome(page);
    await card(page, aTitle).click();
    await readyScore(page, aTitle);
    assert.deepEqual(
      sourceRequests,
      [migrationEntries[0].file],
      "迁移完成后再次进入A仍重新读取",
    );
    assert.deepEqual(errors, []);
    return {
      engine: "chromium",
      passed: true,
      legacySongs: legacy.songs.length,
      finalSongs: expected,
      listSourceRequests: 0,
      sourceRequests,
      visitedFingeringsPreservedAndMigrated: true,
      unvisitedBuiltinBodyRemoved: true,
      removedVisitedSongStillPlayable: true,
      removedUnvisitedSongPruned: true,
      localDailyResultsFavoritesAndSettingsPreserved: true,
      visitedLoopRangeAndStartBeatPreserved: true,
      repeatedAReusesMigratedCache: true,
      pageErrors: errors,
    };
  } catch (error) {
    await page
      .screenshot({ path: path.join(artifacts, "按需旧库迁移失败.png") })
      .catch(() => {});
    throw error;
  } finally {
    await context.close();
    await browser.close();
  }
}

(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  const personal = JSON.parse(
    await fs.readFile(path.join(root, "src/personal-catalogue.json"), "utf8"),
  );
  const reports = [];
  for (const [engine, name] of [
    [chromium, "chromium"],
    [webkit, "webkit"],
  ])
    reports.push(await run(engine, name, entries.length + personal.length));
  const migration = await legacyMigration(personal.length);
  await fs.writeFile(
    path.join(artifacts, "catalogue-lazy-web.json"),
    JSON.stringify({ realDeviceTested: false, reports, migration }, null, 2),
  );
  console.log(JSON.stringify({ reports, migration }, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
