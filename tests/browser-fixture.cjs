const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");
const { parseLocalScore } = require("../scripts/import-scores.cjs");

// Read the actual application defaults without duplicating its TypeScript data.
const modelFile = path.resolve(__dirname, "../src/model.ts");
const model = new Module(modelFile, module);
model.filename = modelFile;
model.paths = Module._nodeModulePaths(path.dirname(modelFile));
model._compile(
  ts.transpileModule(fs.readFileSync(modelFile, "utf8"), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText,
  modelFile,
);

async function openFixture(page, name, bytes) {
  const song = parseLocalScore(name, bytes);
  await page.waitForFunction(
    () => document.querySelector(".app")?.getAttribute("aria-busy") === "false",
  );
  // Let the application's 350 ms save debounce finish before replacing its record.
  await page.waitForTimeout(450);
  await page.evaluate(
    ({ song, defaults }) =>
      new Promise((resolve, reject) => {
        const request = indexedDB.open("qinxi-piano", 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction("data", "readwrite");
          const store = transaction.objectStore("data");
          const read = store.get("library");
          read.onsuccess = () => {
            const previous = read.result;
            if (!Array.isArray(previous?.songs)) {
              reject(Error("浏览器 fixture 需要已保存的未压缩测试曲库"));
              transaction.abort();
              return;
            }
            const selected = previous.settings[previous.lastSong] ?? defaults;
            store.put(
              {
                ...previous,
                songs: [...previous.songs, song],
                lastSong: song.id,
                settings: {
                  ...previous.settings,
                  [song.id]: {
                    ...defaults,
                    inputId: selected.inputId ?? defaults.inputId,
                    outputId: selected.outputId ?? defaults.outputId,
                    from: 1,
                    to: song.measures.length,
                    mode: "wait",
                    loop: false,
                    startBeat: undefined,
                  },
                },
              },
              "library",
            );
          };
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onabort = () => {
            db.close();
            reject(transaction.error ?? Error("浏览器 fixture 保存未完成"));
          };
        };
      }),
    { song, defaults: model.exports.defaults },
  );
  await page.reload();
  await page
    .locator(".music-card")
    .filter({ hasText: song.title })
    .first()
    .click();
  await page.locator(".sheet-host svg").first().waitFor();
  await page.waitForFunction(
    () =>
      document.querySelector(".app")?.getAttribute("aria-busy") === "false" &&
      !document.querySelector(".sheet-loading"),
  );
  return song;
}

module.exports = { openFixture };
