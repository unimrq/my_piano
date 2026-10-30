const path = require("node:path");
const fs = require("node:fs/promises");
const assert = require("node:assert/strict");
const { chromium, webkit } = require("playwright");
const { gunzipSync } = require("fflate");

const base = process.env.QINXI_WEB_URL || "http://localhost:4173";
const artifacts = path.resolve(__dirname, "../test-results");
const nativeTitle = "原谱指法测试";
const secondTitle = "换曲指法测试";
const nativeXml = `<score-partwise version="4.0"><work><work-title>${nativeTitle}</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions><staves>2</staves><time><beats>4</beats><beat-type>4</beat-type></time><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff><notations><technical><fingering>1</fingering></technical></notations></note><note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><staff>1</staff><notations><technical><fingering>3</fingering></technical></notations></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff><notations><technical><fingering>5</fingering></technical></notations></note><note><pitch><step>G</step><octave>3</octave></pitch><duration>2</duration><staff>2</staff><notations><technical><fingering>1</fingering></technical></notations></note></measure></part></score-partwise>`;
const nativeSong = {
  id: "display-native-fingers",
  title: nativeTitle,
  source: "musicxml",
  xml: nativeXml,
  notes: [
    {
      id: "x0",
      xmlIndex: 0,
      midi: 60,
      beat: 0,
      duration: 2,
      track: 0,
      hand: "right",
      finger: 1,
      measure: 0,
      velocity: 80,
    },
    {
      id: "x2",
      xmlIndex: 2,
      midi: 48,
      beat: 0,
      duration: 2,
      track: 0,
      hand: "left",
      finger: 5,
      measure: 0,
      velocity: 80,
    },
    {
      id: "x1",
      xmlIndex: 1,
      midi: 64,
      beat: 2,
      duration: 2,
      track: 0,
      hand: "right",
      finger: 3,
      measure: 0,
      velocity: 80,
    },
    {
      id: "x3",
      xmlIndex: 3,
      midi: 55,
      beat: 2,
      duration: 2,
      track: 0,
      hand: "left",
      finger: 1,
      measure: 0,
      velocity: 80,
    },
  ],
  tracks: [
    { id: 0, name: "Piano", count: 4, low: 48, high: 64, role: "staff" },
  ],
  measures: [
    { index: 0, label: "1", beat: 0, length: 4, beats: 4, beatType: 4 },
  ],
  tempos: [{ beat: 0, bpm: 90 }],
  duration: 4,
};
const secondSong = {
  ...nativeSong,
  id: "display-second-fingers",
  title: secondTitle,
  xml: nativeXml.replaceAll(nativeTitle, secondTitle),
};
const expectedSources = [nativeSong, secondSong].map((song) => ({
  id: song.id,
  xml: song.xml,
  fingers: song.notes.map((note) => [note.id, note.finger]),
}));

// Seed isolated browser storage directly; the web app has no upload interface.
async function seedScores(page) {
  await page.evaluate(
    (songs) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("qinxi-piano", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("data", "readwrite");
          const store = transaction.objectStore("data");
          const read = store.get("library");
          read.onsuccess = () => {
            const saved = read.result;
            const next = {
              ...saved,
              songs: [...saved.songs, ...songs],
              lastSong: songs[0].id,
            };
            // Older libraries without this preference must still show fingerings.
            delete next.showFingering;
            store.put(next, "library");
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => {
            db.close();
            reject(transaction.error);
          };
        };
      }),
    [nativeSong, secondSong],
  );
}

async function librarySnapshot(page) {
  return page.evaluate(
    () =>
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
            const saved = read.result;
            db.close();
            resolve(
              saved
                ? {
                    showFingering: saved.showFingering,
                    songCount: saved.songs.length,
                    sources: saved.songs
                      .filter((song) => song.id.startsWith("display-"))
                      .map((song) => ({
                        id: song.id,
                        xml: song.xml,
                        fingers: song.notes.map((note) => [
                          note.id,
                          note.finger,
                        ]),
                      })),
                  }
                : null,
            );
          };
        };
      }),
  );
}

// Poll resolved IndexedDB snapshots from Node rather than an async waitForFunction.
async function waitForLibrary(page, predicate) {
  const deadline = Date.now() + 20000;
  let snapshot;
  do {
    snapshot = await librarySnapshot(page);
    if (snapshot && predicate(snapshot)) return snapshot;
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw Error(`显示偏好保存未满足预期：${JSON.stringify(snapshot)}`);
}

async function noImportControls(page) {
  assert.equal(await page.locator('input[type="file"]').count(), 0);
  assert.equal(await page.locator(".import-button").count(), 0);
  assert.equal(
    await page
      .getByRole("button", {
        name: /^(导入曲谱|导入曲谱包|上传曲谱|导入|上传)$/,
      })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator(
        'form[enctype="multipart/form-data"], form:has(input[type="file"])',
      )
      .count(),
    0,
  );
}

async function readyHome(page) {
  await page.locator(".music-card").first().waitFor();
  await page.waitForFunction(
    () => document.querySelector(".app")?.getAttribute("aria-busy") === "false",
  );
  await noImportControls(page);
}

async function waitForScore(page, visible) {
  await page.locator(".sheet-host svg").first().waitFor();
  await page.waitForFunction((show) => {
    const holder = document.querySelector(".sheet-host");
    return (
      holder?.getAttribute("aria-busy") === "false" &&
      !!holder.querySelector("svg") &&
      (show
        ? holder.querySelectorAll("[data-fingering-row]").length === 4
        : holder.querySelectorAll("[data-fingering-row]").length === 0)
    );
  }, visible);
  await noImportControls(page);
}

async function touchable(control) {
  const hit = await control.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return (
      bounds.left >= -1 &&
      bounds.right <= innerWidth + 1 &&
      bounds.top >= -1 &&
      bounds.bottom <= innerHeight + 1 &&
      element.contains(
        document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.top + bounds.height / 2,
        ),
      )
    );
  });
  assert(hit, "显示指法控件中心无法触摸或超出视口");
}

async function displayFingering(page, visible) {
  await page.getByTitle("更多设置", { exact: true }).tap();
  await page.getByRole("tab", { name: "显示", exact: true }).tap();
  const control = page.getByLabel("显示指法", { exact: true });
  await touchable(control);
  if ((await control.isChecked()) !== visible) await control.tap();
  assert.equal(await control.isChecked(), visible);
  await noImportControls(page);
  await page.locator(".settings-panel .panel-heading button").tap();
  await waitForScore(page, visible);
  const saved = await waitForLibrary(
    page,
    (value) => value.showFingering === visible,
  );
  assert.deepEqual(
    saved.sources,
    expectedSources,
    "显示开关改写了源XML或音符指法",
  );
}

async function choose(page, title) {
  await page
    .locator(".music-card")
    .getByRole("button", { name: title, exact: true })
    .tap();
}

async function compressedLibraryRoundtrip(browser, name) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  const copies = 20;
  const commentSize = 1024 * 1024;
  try {
    await page.goto(base);
    await readyHome(page);
    const initial = await waitForLibrary(page, (value) => value.songCount > 0);
    const expectedCount = initial.songCount + copies;
    // Write the former plain-object format, comfortably below IDB's record limit.
    const legacy = await page.evaluate(
      ({ song, count, paddingBytes }) =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("qinxi-piano", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const transaction = db.transaction("data", "readwrite");
            const store = transaction.objectStore("data");
            const read = store.get("library");
            let summary;
            read.onsuccess = () => {
              const saved = read.result;
              const padding = `<!--${"A".repeat(paddingBytes)}-->`;
              const additions = Array.from({ length: count }, (_, index) => {
                const title = `大库测试${index + 1}`;
                return {
                  ...song,
                  id: `large-storage-${index + 1}`,
                  title,
                  xml: song.xml.replaceAll(song.title, title) + padding,
                };
              });
              const next = {
                ...saved,
                songs: [...saved.songs, ...additions],
                showFingering: false,
              };
              summary = {
                legacyPlainObject: !next.encoding,
                songCount: next.songs.length,
                estimatedBytes: next.songs.reduce(
                  (sum, item) =>
                    sum + item.xml.length * 2 + item.notes.length * 200,
                  0,
                ),
              };
              store.put(next, "library");
            };
            transaction.oncomplete = () => {
              db.close();
              resolve(summary);
            };
            transaction.onerror = () => {
              db.close();
              reject(transaction.error);
            };
          };
        }),
      { song: nativeSong, count: copies, paddingBytes: commentSize },
    );
    assert.equal(legacy.legacyPlainObject, true);
    assert.equal(legacy.songCount, expectedCount);
    assert(legacy.estimatedBytes > 32 * 1024 * 1024);
    assert(legacy.estimatedBytes < 133 * 1024 * 1024);
    await page.reload();
    await readyHome(page);
    await page
      .getByText(`${expectedCount} 首本地曲目`, { exact: true })
      .waitFor();
    const deadline = Date.now() + 45000;
    let record;
    do {
      record = await page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const request = indexedDB.open("qinxi-piano", 1);
            request.onerror = () => reject(request.error);
            request.onsuccess = () => {
              const db = request.result;
              const read = db
                .transaction("data")
                .objectStore("data")
                .get("library");
              read.onsuccess = () => {
                const value = read.result;
                db.close();
                resolve({
                  encoding: value?.encoding,
                  typedArray: value?.data instanceof Uint8Array,
                  bytes: value?.data?.byteLength ?? 0,
                });
              };
              read.onerror = () => {
                db.close();
                reject(read.error);
              };
            };
          }),
      );
      if (
        record.encoding === "gzip-json-v1" &&
        record.typedArray &&
        record.bytes > 0
      )
        break;
      await page.waitForTimeout(100);
    } while (Date.now() < deadline);
    assert.equal(record.encoding, "gzip-json-v1", "大曲库没有压缩保存");
    assert.equal(record.typedArray, true);
    assert(record.bytes > 0);
    const compressed = await page.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const request = indexedDB.open("qinxi-piano", 1);
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const db = request.result;
            const read = db
              .transaction("data")
              .objectStore("data")
              .get("library");
            read.onsuccess = () => {
              db.close();
              resolve(Array.from(read.result.data));
            };
            read.onerror = () => {
              db.close();
              reject(read.error);
            };
          };
        }),
    );
    // Decode only in Node; the browser returns compressed bytes, not a second huge JSON.
    const decoded = JSON.parse(
      new TextDecoder().decode(gunzipSync(new Uint8Array(compressed))),
    );
    assert.equal(decoded.songs.length, expectedCount);
    assert.equal(decoded.showFingering, false);
    const additions = decoded.songs.filter((song) =>
      song.id.startsWith("large-storage-"),
    );
    assert.equal(additions.length, copies);
    const comment = `<!--${"A".repeat(commentSize)}-->`;
    for (const [index, song] of additions.entries()) {
      assert.equal(song.id, `large-storage-${index + 1}`);
      assert.equal(song.source, "musicxml");
      assert.equal(
        song.xml,
        nativeXml.replaceAll(nativeTitle, `大库测试${index + 1}`) + comment,
      );
      assert.deepEqual(song.notes, nativeSong.notes);
    }
    await page.reload();
    await readyHome(page);
    await page
      .getByText(`${expectedCount} 首本地曲目`, { exact: true })
      .waitFor();
    // Render one small score with a large XML comment, rather than the whole library.
    await choose(page, "大库测试1");
    await waitForScore(page, false);
    await page.getByTitle("更多设置", { exact: true }).tap();
    await page.getByRole("tab", { name: "显示", exact: true }).tap();
    assert.equal(
      await page.getByLabel("显示指法", { exact: true }).isChecked(),
      false,
    );
    await noImportControls(page);
    assert.deepEqual(errors, []);
    return {
      legacyPlainObjectLoaded: true,
      initialSongs: initial.songCount,
      syntheticSongs: copies,
      totalSongs: expectedCount,
      estimatedBytes: legacy.estimatedBytes,
      compressedBytes: record.bytes,
      encoding: record.encoding,
      sourceXmlAndNotesPreserved: true,
      compressedReloadPassed: true,
      hiddenFingeringPreserved: true,
    };
  } catch (error) {
    await page.screenshot({
      path: path.join(artifacts, `大曲库压缩检查失败-${name}.png`),
      fullPage: true,
    });
    throw error;
  } finally {
    await context.close();
  }
}

async function run(engine, name) {
  const browser = await engine.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
    locale: "zh-CN",
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  try {
    await page.goto(base);
    await readyHome(page);
    await waitForLibrary(page, (value) => value.songCount > 0);
    await seedScores(page);
    await page.reload();
    await readyHome(page);
    await choose(page, nativeTitle);
    await waitForScore(page, true);
    await displayFingering(page, false);
    await page.screenshot({
      path: path.join(artifacts, `指法隐藏-${name}.png`),
    });
    await displayFingering(page, true);
    await displayFingering(page, false);
    await page.getByRole("button", { name: "曲库", exact: true }).tap();
    await readyHome(page);
    await choose(page, secondTitle);
    await waitForScore(page, false);
    await page.getByTitle("更多设置", { exact: true }).tap();
    await page.getByRole("tab", { name: "显示", exact: true }).tap();
    assert.equal(
      await page.getByLabel("显示指法", { exact: true }).isChecked(),
      false,
    );
    await page.locator(".settings-panel .panel-heading button").tap();
    await page.reload();
    await readyHome(page);
    const persisted = await waitForLibrary(
      page,
      (value) => value.showFingering === false,
    );
    assert.deepEqual(persisted.sources, expectedSources);
    await choose(page, secondTitle);
    await waitForScore(page, false);
    await displayFingering(page, true);
    await page.screenshot({
      path: path.join(artifacts, `指法显示-${name}.png`),
    });
    const largeLibrary = await compressedLibraryRoundtrip(browser, name);
    assert.deepEqual(errors, []);
    return {
      engine: name,
      passed: true,
      nativeFingerings: 4,
      defaultVisibleForOlderLibrary: true,
      originalXmlAndNoteFingeringsPreserved: true,
      hiddenPreferencePersistsAfterSongChangeAndReload: true,
      webImportControlsAbsent: true,
      phoneViewport: { width: 390, height: 844 },
      displayCheckboxTouchable: true,
      largeLibrary,
      pageErrors: errors,
    };
  } catch (error) {
    await page.screenshot({
      path: path.join(artifacts, `指法显示检查失败-${name}.png`),
      fullPage: true,
    });
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
    path.join(artifacts, "display-fingering-web.json"),
    JSON.stringify({ realPhoneTested: false, reports }, null, 2),
  );
  console.log(JSON.stringify(reports, null, 2));
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
