// Trusted server-side command. Score files are parsed as data, never executed.
const fs = require("node:fs/promises");
const syncFs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const { createHash, randomUUID } = require("node:crypto");
const { parseArgs } = require("node:util");
const ts = require("typescript");

const repo = path.resolve(__dirname, "..");
const supported = /\.(mid|midi|xml|musicxml|mxl|zip)$/i;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const modules = new Map();
function loadTypeScript(filename) {
  if (modules.has(filename)) return modules.get(filename).exports;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  modules.set(filename, loaded);
  const nodeRequire = loaded.require.bind(loaded);
  loaded.require = (name) =>
    name.startsWith(".")
      ? loadTypeScript(path.resolve(path.dirname(filename), `${name}.ts`))
      : nodeRequire(name);
  loaded._compile(
    ts.transpileModule(syncFs.readFileSync(filename, "utf8"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
      },
    }).outputText,
    filename,
  );
  return loaded.exports;
}
async function readIndex(filename) {
  try {
    const entries = JSON.parse(await fs.readFile(filename, "utf8"));
    if (!Array.isArray(entries)) throw Error(`曲库索引不是数组：${filename}`);
    return entries;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}
async function listFiles(input) {
  const result = [];
  const walk = async (filename) => {
    const info = await fs.lstat(filename);
    if (info.isSymbolicLink()) return;
    if (info.isDirectory()) {
      for (const name of (await fs.readdir(filename)).sort()) {
        if (name === "__MACOSX" || name.startsWith("._")) continue;
        await walk(path.join(filename, name));
      }
    } else if (info.isFile() && supported.test(filename)) {
      result.push(filename);
      if (result.length > 1000) throw Error("输入目录中的曲谱文件超过 1000 个");
    }
  };
  await walk(input);
  const preferred = result.some((filename) =>
    path.relative(input, filename).split(path.sep).includes("可直接导入"),
  );
  return preferred
    ? result.filter((filename) =>
        path.relative(input, filename).split(path.sep).includes("可直接导入"),
      )
    : result;
}
function parseSong(importScore, name, bytes) {
  if (/\.(mid|midi)$/i.test(name)) return importScore(name, bytes);
  const { JSDOM } = require("jsdom");
  const window = new JSDOM("").window;
  globalThis.DOMParser = window.DOMParser;
  try {
    return importScore(name, bytes);
  } finally {
    delete globalThis.DOMParser;
    window.close();
  }
}
function parseLocalScore(name, bytes) {
  const { importScore } = loadTypeScript(path.join(repo, "src", "importer.ts"));
  return parseSong(importScore, path.basename(name), bytes);
}
async function run() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      write: { type: "boolean", default: false },
      title: { type: "string" },
      category: { type: "string" },
      difficulty: { type: "string" },
      composer: { type: "string" },
      "source-url": { type: "string" },
      license: { type: "string" },
      "output-root": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/import-scores.cjs <file-or-directory> [--write] [--title 单首标题] [--category 分类] [--difficulty 难度] [--composer 作者] [--source-url 来源URL] [--license 许可] [--output-root 隔离输出根目录]\n默认仅检查；--write 才会增补服务器曲库文件和索引。",
    );
    return;
  }
  if (positionals.length !== 1)
    throw Error("请指定一个本地曲谱文件、ZIP 或目录；使用 --help 查看参数");
  if (
    values["source-url"] &&
    !["http:", "https:"].includes(new URL(values["source-url"]).protocol)
  )
    throw Error("来源 URL 仅支持 http 或 https，仅记录元数据、不访问网络");
  const input = path.resolve(positionals[0]);
  const outputRoot = path.resolve(values["output-root"] ?? repo);
  const catalogueRoot = path.join(outputRoot, "public", "catalogue");
  const indexFile = path.join(outputRoot, "src", "personal-catalogue.json");
  const current = await readIndex(indexFile);
  const known = [
    ...current,
    ...(await readIndex(path.join(catalogueRoot, "manifest.json"))),
  ];
  const byHash = new Map(
    known.filter((e) => e.sha256).map((e) => [e.sha256, e]),
  );
  const byId = new Map(known.map((e) => [e.id, e]));
  const { unpackScoreFiles } = loadTypeScript(
    path.join(repo, "src", "importer.ts"),
  );
  const items = [],
    candidates = [];
  let totalBytes = 0;
  const inputFiles = await listFiles(input);
  if (!inputFiles.length)
    throw Error("输入中没有 MIDI、MusicXML、MXL 或 ZIP 文件");
  for (const filename of inputFiles) {
    try {
      const limit = (/\.zip$/i.test(filename) ? 50 : 10) * 1024 * 1024;
      if ((await fs.stat(filename)).size > limit)
        throw Error(`文件超过 ${limit / 1024 / 1024} MB`);
      const bytes = new Uint8Array(await fs.readFile(filename));
      for (const file of await unpackScoreFiles(
        path.basename(filename),
        bytes,
      )) {
        candidates.push({
          ...file,
          source: /\.zip$/i.test(filename)
            ? `${filename}:${file.name}`
            : filename,
        });
        totalBytes += file.bytes.length;
      }
    } catch (error) {
      items.push({ source: filename, status: "failed", error: String(error) });
    }
    if (candidates.length > 1000) throw Error("待导入曲谱超过 1000 首");
    if (totalBytes > 100 * 1024 * 1024)
      throw Error("待导入曲谱总大小超过 100 MB");
  }
  if (values.title && candidates.length !== 1)
    throw Error("--title 仅用于单首曲谱，请分开导入或保留各曲原名");
  const ready = [];
  for (const candidate of candidates) {
    const sha256 = hash(candidate.bytes);
    const existing = byHash.get(sha256);
    if (existing) {
      items.push({
        source: candidate.source,
        status: "skipped",
        id: existing.id,
        title: existing.title,
        file: existing.file,
        sha256,
        notes: existing.expectedNotes,
      });
      continue;
    }
    try {
      const name = candidate.name.split("/").at(-1);
      const song = parseLocalScore(name, candidate.bytes);
      if (
        song.notes.some(
          (note) =>
            !Number.isFinite(note.beat) ||
            note.beat < -0.000001 ||
            !Number.isFinite(note.duration) ||
            note.duration <= 0 ||
            !Number.isInteger(note.midi) ||
            note.midi < 0 ||
            note.midi > 127,
        )
      )
        throw Error("曲谱包含无法练习的音符：无效音高、起音或时值");
      const id = `imported-${sha256.slice(0, 16)}`;
      if (byId.has(id)) throw Error("曲目 ID 冲突，保留现有曲目");
      const extension = /\.(mid|midi)$/i.test(name)
        ? "mid"
        : /\.mxl$/i.test(name)
          ? "mxl"
          : "musicxml";
      const parts = candidate.name.split("/");
      const readyDirectory = parts.indexOf("可直接导入");
      const entry = {
        id,
        title: values.title ?? song.title,
        composer: values.composer ?? "未标注",
        difficulty: values.difficulty ?? "未标注",
        category:
          values.category ??
          (readyDirectory >= 0 && readyDirectory < parts.length - 2
            ? parts[readyDirectory + 1]
            : "本地曲谱"),
        focus: song.source === "midi" ? "MIDI 自动转谱" : "原有 MusicXML 谱面",
        file: `${id}.${extension}`,
        license: values.license ?? "来源许可未确认；本地个人收藏",
        attribution: "本地文件导入；原作者及编配者信息以来源为准",
        sourceUrl: values["source-url"] ?? "",
        edition:
          song.source === "midi"
            ? "本地原始 MIDI 文件；五线谱为自动转谱参考"
            : "本地原始 MusicXML 文件；保留原有谱面信息",
        sha256,
        expectedNotes: song.notes.length,
      };
      byHash.set(sha256, entry);
      byId.set(id, entry);
      const item = {
        source: candidate.source,
        status: "ready",
        id,
        title: entry.title,
        file: entry.file,
        sha256,
        notes: song.notes.length,
      };
      items.push(item);
      ready.push({ entry, bytes: candidate.bytes, item });
    } catch (error) {
      items.push({
        source: candidate.source,
        status: "failed",
        sha256,
        error: String(error),
      });
    }
  }
  const added = [];
  if (values.write && ready.length) {
    await fs.mkdir(catalogueRoot, { recursive: true });
    await fs.mkdir(path.dirname(indexFile), { recursive: true });
    for (const candidate of ready) {
      const destination = path.join(catalogueRoot, candidate.entry.file);
      try {
        try {
          await fs.writeFile(destination, candidate.bytes, { flag: "wx" });
        } catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (hash(await fs.readFile(destination)) !== candidate.entry.sha256)
            throw Error(`文件已存在且内容不同，不会覆盖：${destination}`);
        }
        added.push(candidate.entry);
        candidate.item.status = "added";
      } catch (error) {
        candidate.item.status = "failed";
        candidate.item.error = String(error);
        for (const item of items) {
          if (
            item.status === "skipped" &&
            item.sha256 === candidate.entry.sha256
          ) {
            item.status = "failed";
            item.error = "同一曲目的原始候选未能写入：" + String(error);
          }
        }
      }
    }
    if (added.length) {
      const temporary = `${indexFile}.${randomUUID()}.tmp`;
      await fs.writeFile(
        temporary,
        JSON.stringify([...current, ...added], null, 2) + "\n",
        { flag: "wx" },
      );
      await fs.rename(temporary, indexFile);
    }
  }
  const counts = {
    ready: ready.length,
    added: added.length,
    skipped: items.filter((item) => item.status === "skipped").length,
    failed: items.filter((item) => item.status === "failed").length,
  };
  console.log(
    JSON.stringify(
      {
        mode: values.write ? "write" : "dry-run",
        input,
        outputRoot,
        counts,
        items,
      },
      null,
      2,
    ),
  );
  if (
    !(values.write
      ? counts.added + counts.skipped
      : counts.ready + counts.skipped)
  )
    process.exitCode = 1;
}
module.exports = { parseLocalScore };
if (require.main === module)
  run().catch((error) => {
    console.error(JSON.stringify({ error: String(error) }));
    process.exitCode = 1;
  });
