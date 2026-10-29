const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, ".."),
  seen = new Set(),
  texts = [];
function walk(name, base = root) {
  let packagePath;
  try {
    packagePath = require.resolve(name + "/package.json", { paths: [base] });
  } catch (error) {
    if (error.code !== "ERR_PACKAGE_PATH_NOT_EXPORTED") throw error;
    let current = path.dirname(require.resolve(name, { paths: [base] }));
    while (!fs.existsSync(path.join(current, "package.json"))) {
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
    packagePath = path.join(current, "package.json");
  }
  const dir = path.dirname(packagePath);
  const pkg = JSON.parse(
    fs.readFileSync(path.join(dir, "package.json"), "utf8"),
  );
  const key = pkg.name + "@" + pkg.version;
  if (seen.has(key)) return;
  seen.add(key);
  const licenses = fs
    .readdirSync(dir)
    .filter(
      (f) =>
        /^(licen[sc]e|notice|copyright)/i.test(f) &&
        fs.statSync(path.join(dir, f)).isFile(),
    );
  texts.push(
    `\n${"=".repeat(72)}\n${key} — ${pkg.license || "see upstream"}\n${licenses.map((f) => fs.readFileSync(path.join(dir, f), "utf8")).join("\n")}`,
  );
  for (const dependency of Object.keys(pkg.dependencies || {}))
    walk(dependency, dir);
}
const pkg = JSON.parse(
  fs.readFileSync(path.join(root, "package.json"), "utf8"),
);
for (const name of [
  "@tonejs/midi",
  "fflate",
  "opensheetmusicdisplay",
  "react",
  "react-dom",
  "pixi.js",
])
  walk(name);
fs.writeFileSync(path.join(root, "LICENSES.third-party.txt"), texts.join("\n"));
console.log("Production license notices:", seen.size);
