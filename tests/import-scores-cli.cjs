const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { Midi } = require("@tonejs/midi");
const { zipSync, strToU8 } = require("fflate");

const repo = path.resolve(__dirname, "..");
const results = path.join(repo, "test-results");
fs.mkdirSync(results, { recursive: true });
function fixture() {
  const directory = fs.mkdtempSync(path.join(results, "import-cli-"));
  return { directory, output: path.join(directory, "output") };
}
function midi(pitch = 60, duration = 1) {
  const song = new Midi();
  song.addTrack().addNote({ midi: pitch, time: 0, duration });
  return song.toArray();
}
function run(input, output, ...args) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(repo, "scripts/import-scores.cjs"),
      input,
      "--output-root",
      output,
      ...args,
    ],
    { cwd: repo, encoding: "utf8", maxBuffer: 4 * 1024 * 1024 },
  );
  assert.ifError(result.error);
  return {
    code: result.status,
    report: JSON.parse(result.stdout || result.stderr),
  };
}
const indexPath = (output) =>
  path.join(output, "src", "personal-catalogue.json");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("默认 dry-run 验证原曲但不创建输出目录", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "测试.mid");
  const bytes = midi();
  fs.writeFileSync(input, bytes);
  const { code, report } = run(input, output);
  assert.equal(code, 0);
  assert.equal(report.mode, "dry-run");
  assert.deepEqual(report.counts, {
    ready: 1,
    added: 0,
    skipped: 0,
    failed: 0,
  });
  assert.equal(report.items[0].id, `imported-${sha(bytes).slice(0, 16)}`);
  assert.equal(fs.existsSync(output), false);
});

test("写入保留已有四首、元数据与原字节，重复导入保持幂等", () => {
  const { directory, output } = fixture();
  const current = JSON.parse(
    fs.readFileSync(path.join(repo, "src/personal-catalogue.json"), "utf8"),
  );
  fs.mkdirSync(path.dirname(indexPath(output)), { recursive: true });
  fs.writeFileSync(indexPath(output), JSON.stringify(current));
  const input = path.join(directory, "新歌.mid");
  const bytes = midi();
  fs.writeFileSync(input, bytes);
  const first = run(
    input,
    output,
    "--write",
    "--title",
    "新曲标题",
    "--category",
    "中文流行",
    "--difficulty",
    "入门",
    "--composer",
    "来源作者",
    "--source-url",
    "https://example.test/score",
    "--license",
    "来源允许个人练习",
  );
  assert.equal(first.code, 0);
  assert.equal(first.report.counts.added, 1);
  const stored = JSON.parse(fs.readFileSync(indexPath(output), "utf8"));
  assert.deepEqual(stored.slice(0, current.length), current);
  assert.equal(stored.length, current.length + 1);
  const entry = stored.at(-1);
  assert.equal(entry.title, "新曲标题");
  assert.equal(entry.category, "中文流行");
  assert.equal(entry.difficulty, "入门");
  assert.equal(entry.composer, "来源作者");
  assert.equal(entry.license, "来源允许个人练习");
  assert.equal(entry.sourceUrl, "https://example.test/score");
  assert.equal(entry.expectedNotes, 1);
  assert.deepEqual(
    fs.readFileSync(path.join(output, "public/catalogue", entry.file)),
    Buffer.from(bytes),
  );
  const again = run(input, output, "--write");
  assert.equal(again.code, 0);
  assert.equal(again.report.counts.added, 0);
  assert.equal(again.report.counts.skipped, 1);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(indexPath(output), "utf8")),
    stored,
  );
});

test("ZIP 可直接导入目录优先，不导入备份或待检查文件", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "曲库.zip");
  fs.writeFileSync(
    input,
    zipSync({
      "完美钢琴/可直接导入/中文流行/主曲.mid": midi(),
      "完美钢琴/MIDI备份/备份.mid": midi(62),
      "完美钢琴/需检查/坏.mid": strToU8("bad"),
    }),
  );
  const { code, report } = run(input, output, "--write");
  assert.equal(code, 0);
  assert.equal(report.counts.added, 1);
  const [entry] = JSON.parse(fs.readFileSync(indexPath(output), "utf8"));
  assert.equal(entry.title, "主曲");
  assert.equal(entry.category, "中文流行");
});

test("MusicXML 与 MXL 写入保留原字节并使用前端支持的扩展名", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "原谱");
  fs.mkdirSync(input);
  const xml = strToU8(
    '<score-partwise version="4.0"><work><work-title>双手谱</work-title></work><part-list><score-part id="P"><part-name>Piano</part-name></score-part></part-list><part id="P"><measure number="1"><attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves></attributes><note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><staff>1</staff></note><backup><duration>4</duration></backup><note><pitch><step>C</step><octave>3</octave></pitch><duration>4</duration><staff>2</staff></note></measure></part></score-partwise>',
  );
  const mxl = zipSync({
    "META-INF/container.xml": strToU8(
      '<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>',
    ),
    "score.xml": xml,
  });
  fs.writeFileSync(path.join(input, "原谱.xml"), xml);
  fs.writeFileSync(path.join(input, "压缩谱.mxl"), mxl);
  const { code, report } = run(input, output, "--write");
  assert.equal(code, 0);
  assert.equal(report.counts.added, 2);
  const stored = JSON.parse(fs.readFileSync(indexPath(output), "utf8"));
  assert.deepEqual(stored.map((entry) => path.extname(entry.file)).sort(), [
    ".musicxml",
    ".mxl",
  ]);
  for (const entry of stored) {
    assert.equal(entry.title, "双手谱");
    assert.equal(entry.expectedNotes, 2);
    assert.match(entry.license, /未确认/);
    assert.equal(entry.sourceUrl, "");
    const bytes = fs.readFileSync(
      path.join(output, "public/catalogue", entry.file),
    );
    assert.equal(sha(bytes), entry.sha256);
    assert.deepEqual(
      bytes,
      Buffer.from(entry.file.endsWith(".mxl") ? mxl : xml),
    );
  }
});

test("普通 ZIP 分别报告损坏与零时长文件，正常曲目仍可写入并去重", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "混合.zip");
  const zeroDuration = new Midi();
  zeroDuration
    .addTrack()
    .addNote({ midi: 62, time: 0, duration: 0 })
    .addNote({ midi: 64, time: 1, duration: 1 });
  fs.writeFileSync(
    input,
    zipSync({
      "有效.mid": midi(),
      "重复/有效.mid": midi(),
      "坏.mid": strToU8("bad"),
      "零时长.mid": zeroDuration.toArray(),
    }),
  );
  const { code, report } = run(input, output, "--write");
  assert.equal(code, 0);
  assert.equal(report.counts.added, 1);
  assert.equal(report.counts.failed, 2);
  assert.ok(report.items.some((item) => /时值/.test(item.error ?? "")));
  assert.equal(
    JSON.parse(fs.readFileSync(indexPath(output), "utf8")).length,
    1,
  );
});

test("目录递归读取，单首标题选项不能误改整个曲库", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "曲谱");
  fs.mkdirSync(path.join(input, "子目录"), { recursive: true });
  fs.writeFileSync(path.join(input, "第一首.mid"), midi());
  fs.writeFileSync(path.join(input, "子目录/第二首.mid"), midi(62));
  fs.writeFileSync(path.join(input, "说明.txt"), "不是曲谱");
  const rejected = run(input, output, "--write", "--title", "不能共用");
  assert.equal(rejected.code, 1);
  assert.match(rejected.report.error, /单首/);
  assert.equal(fs.existsSync(output), false);
  const checked = run(input, output);
  assert.equal(checked.code, 0);
  assert.equal(checked.report.counts.ready, 2);
  assert.equal(fs.existsSync(output), false);
});

test("空包、路径穿越及危险来源 URL 不产生目录或索引", () => {
  for (const files of [{}, { "../越界.mid": midi() }]) {
    const { directory, output } = fixture();
    const input = path.join(directory, "拒绝.zip");
    fs.writeFileSync(input, zipSync(files));
    assert.equal(run(input, output, "--write").code, 1);
    assert.equal(fs.existsSync(output), false);
  }
  const { directory, output } = fixture();
  const input = path.join(directory, "有效.mid");
  fs.writeFileSync(input, midi());
  const rejected = run(
    input,
    output,
    "--write",
    "--source-url",
    "javascript:alert(1)",
  );
  assert.equal(rejected.code, 1);
  assert.match(rejected.report.error, /http/);
  assert.equal(fs.existsSync(output), false);
});

test("已有不同内容的目标文件不会被覆盖", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "有效.mid");
  const bytes = midi();
  fs.writeFileSync(input, bytes);
  const destination = path.join(
    output,
    "public/catalogue",
    `imported-${sha(bytes).slice(0, 16)}.mid`,
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, "保留现有文件");
  const { code, report } = run(input, output, "--write");
  assert.equal(code, 1);
  assert.equal(report.counts.added, 0);
  assert.equal(report.counts.failed, 1);
  assert.match(report.items[0].error, /不会覆盖/);
  assert.equal(fs.readFileSync(destination, "utf8"), "保留现有文件");
  assert.equal(fs.existsSync(indexPath(output)), false);
});

test("批内重复曲目的原候选写入失败时，不会以重复跳过伪报成功", () => {
  const { directory, output } = fixture();
  const input = path.join(directory, "重复目录");
  const bytes = midi();
  fs.mkdirSync(input);
  fs.writeFileSync(path.join(input, "第一份.mid"), bytes);
  fs.writeFileSync(path.join(input, "第二份.mid"), bytes);
  const destination = path.join(
    output,
    "public/catalogue",
    `imported-${sha(bytes).slice(0, 16)}.mid`,
  );
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, "保留现有冲突文件");
  const checked = run(input, output);
  assert.equal(checked.code, 0);
  assert.deepEqual(checked.report.counts, {
    ready: 1,
    added: 0,
    skipped: 1,
    failed: 0,
  });
  const written = run(input, output, "--write");
  assert.equal(written.code, 1);
  assert.deepEqual(written.report.counts, {
    ready: 1,
    added: 0,
    skipped: 0,
    failed: 2,
  });
  assert.ok(written.report.items.every((item) => item.status === "failed"));
  assert.ok(
    written.report.items.some((item) => /原始候选未能写入/.test(item.error)),
  );
  assert.equal(fs.readFileSync(destination, "utf8"), "保留现有冲突文件");
  assert.equal(fs.existsSync(indexPath(output)), false);
});
