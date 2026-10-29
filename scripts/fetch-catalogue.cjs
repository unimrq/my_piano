// Download existing editions byte-for-byte; this script never arranges music.
const fs = require("node:fs/promises"),
  path = require("node:path"),
  { createHash } = require("node:crypto");
const root = path.resolve(__dirname, "../public/catalogue");
async function run() {
  const entries = JSON.parse(
    await fs.readFile(path.join(root, "manifest.json"), "utf8"),
  );
  for (const entry of entries) {
    const response = await fetch(entry.downloadUrl);
    if (!response.ok) throw Error(`${entry.title}: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== entry.sha256)
      throw Error(`${entry.title}: 来源文件已变化，请核对版本后再更新索引`);
    await fs.writeFile(path.join(root, entry.file), bytes);
    console.log(entry.title);
  }
}
run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
