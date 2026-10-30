const assert = require("node:assert/strict");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const pop = JSON.parse(
  readFileSync(path.join(root, "src/personal-catalogue.json"), "utf8"),
);
const docker = (...args) =>
  execFileSync("docker", args, { cwd: root, encoding: "utf8" }).trim();
const inside = (...args) => docker("compose", "exec", "-T", "piano", ...args);
const request = (url, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: process.env.PIANO_PORT || 8080,
        path: url,
        method,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    req.setTimeout(10000, () =>
      req.destroy(new Error("HTTP request timed out")),
    );
    req.on("error", reject);
    req.end();
  });

(async () => {
  const id = docker("compose", "ps", "-q", "piano");
  assert(id, "piano container is running");
  const [container] = JSON.parse(docker("inspect", id));
  assert.equal(container.State.Health.Status, "healthy");
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.HostConfig.Privileged, false);
  assert(container.HostConfig.CapDrop.includes("ALL"));
  assert(container.HostConfig.SecurityOpt.includes("no-new-privileges:true"));
  assert(!container.Mounts.some((mount) => mount.Type === "bind"));
  assert.equal(
    container.HostConfig.PortBindings["8080/tcp"][0].HostIp,
    process.env.PIANO_BIND || "127.0.0.1",
  );
  assert.notEqual(inside("id", "-u"), "0");
  inside("nginx", "-t");
  inside(
    "sh",
    "-c",
    "test ! -w /usr/share/nginx/html && touch /tmp/piano-check && rm /tmp/piano-check",
  );
  assert.equal(
    inside("sh", "-c", "find /usr/share/nginx/html -name 'personal-*' | wc -l"),
    "4",
  );

  const page = await request("/");
  assert.equal(page.status, 200);
  assert.match(page.headers["content-type"], /text\/html/);
  assert.equal(page.headers["x-frame-options"], "DENY");
  assert.equal(page.headers["x-content-type-options"], "nosniff");
  assert.equal(page.headers["referrer-policy"], "no-referrer");
  assert.match(
    page.headers["content-security-policy"],
    /frame-ancestors 'none'/,
  );
  assert.match(page.headers["permissions-policy"], /midi=\(self\)/);
  const head = await request("/", "HEAD");
  assert.equal(head.status, 200);
  assert.equal(head.body.length, 0);
  assert.equal((await request("/", "POST")).status, 405);

  const sw = await request("/sw.js");
  assert.equal(sw.status, 200);
  const files = JSON.parse(
    sw.body.toString().match(/const FILES = (\[[^;]+\]);/)[1],
  );
  assert(files.some((file) => /fingering\.worker-.*\.js$/.test(file)));
  assert(files.some((file) => /licenses\/PianoPlayer-MIT\.txt$/.test(file)));
  assert(files.includes("./catalogue/manifest.json"));
  assert(
    files.every(
      (file) => !/^\.\/catalogue\/.*\.(mid|midi|xml|musicxml|mxl)$/i.test(file),
    ),
    "曲谱应按需缓存，不应出现在预缓存列表中",
  );
  for (const id of [
    "personal-moon",
    "personal-name",
    "personal-sunny",
    "personal-porcelain",
  ])
    assert(
      pop.some((score) => score.id === id),
      id,
    );
  for (const score of pop) {
    if (score.id.startsWith("personal-")) {
      assert.doesNotMatch(score.license, /CC0|MIT/i, score.title);
      assert(score.attribution && score.sourceUrl, score.title);
    }
    const resource = await request("/catalogue/" + score.file);
    assert.equal(resource.status, 200, score.file);
    assert.equal(
      createHash("sha256").update(resource.body).digest("hex"),
      score.sha256,
      score.file,
    );
  }
  assert(files.includes("./audio/piano/manifest.json"));
  const audioManifest = await request("/audio/piano/manifest.json");
  assert.equal(audioManifest.status, 200);
  assert.match(audioManifest.headers["content-type"], /application\/json/);
  const piano = JSON.parse(audioManifest.body);
  assert.equal(piano.author, "Alexander Holm");
  assert.equal(piano.license, "CC BY 3.0");
  assert.equal(piano.sourceCommit, "efd8296360f9526e379bfbe5c1698ff54d6a1d34");
  assert.equal(piano.sampleCount, 30);
  assert.equal(piano.samples.length, 30);
  assert.deepEqual(
    piano.samples.map((sample) => sample.midi),
    Array.from({ length: 30 }, (_, i) => 21 + i * 3),
  );
  assert.equal(
    files.filter((file) => /^\.\/audio\/piano\/.*\.mp3$/.test(file)).length,
    30,
  );
  for (const sample of piano.samples)
    assert(files.includes("./audio/piano/" + sample.file), sample.file);
  for (const file of ["Salamander-CC-BY-3.0.txt", "Salamander-ATTRIBUTION.txt"])
    assert(files.includes("./licenses/" + file), file);
  let pianoBytes = 0;
  for (const file of files) {
    const resource = await request("/" + file.replace(/^\.\//, ""));
    assert.equal(resource.status, 200, file);
    if (file.endsWith(".js"))
      assert.match(resource.headers["content-type"], /javascript/, file);
    if (file.endsWith(".css"))
      assert.match(resource.headers["content-type"], /text\/css/, file);
    const sample = piano.samples.find(
      (sample) => file === "./audio/piano/" + sample.file,
    );
    if (sample) {
      assert.match(
        resource.headers["content-type"],
        /^audio\/mpeg(?:;|$)/,
        file,
      );
      assert.equal(resource.body.length, sample.bytes, file);
      assert.equal(
        createHash("sha256").update(resource.body).digest("hex"),
        sample.sha256,
        file,
      );
      pianoBytes += resource.body.length;
    }
    if (file === "./licenses/Salamander-CC-BY-3.0.txt") {
      assert.match(resource.headers["content-type"], /text\/plain/, file);
      const text = resource.body.toString().replaceAll("\r\n", "\n");
      assert.match(
        text,
        /^Creative Commons Legal Code\s+Attribution 3\.0 Unported/,
      );
      assert.equal(
        createHash("sha256").update(text).digest("hex"),
        piano.licenseText.sha256,
        file,
      );
    }
    if (file === "./licenses/Salamander-ATTRIBUTION.txt") {
      assert.match(resource.headers["content-type"], /text\/plain/, file);
      const text = resource.body.toString();
      assert.match(text, /Original author: Alexander Holm/);
      assert.match(text, /Distribution source: Tone\.js audio repository/);
      assert(text.includes(piano.sourceCommit));
      assert.match(
        text,
        /Creative Commons Attribution 3\.0 Unported \(CC BY 3\.0\)/,
      );
      assert(text.includes(piano.licenseUrl));
    }
  }
  assert.equal(pianoBytes, piano.sampleBytes);
  const manifest = JSON.parse((await request("/catalogue/manifest.json")).body);
  assert.equal(manifest.length, 5);
  for (const score of manifest) {
    const resource = await request("/catalogue/" + score.file);
    assert.equal(resource.status, 200, score.file);
    assert.equal(
      createHash("sha256").update(resource.body).digest("hex"),
      score.sha256,
      score.file,
    );
  }

  for (const url of [
    "/.env",
    "/package.json",
    "/src/App.tsx",
    "/%00",
    "/%GG",
    "/%2e%2e%2fetc/passwd",
    "/licenses/../../etc/passwd",
  ]) {
    assert([400, 403, 404].includes((await request(url)).status), url);
  }
  assert.equal((await request("/")).status, 200);
  console.log(
    JSON.stringify({
      passed: true,
      cachedResources: files.length,
      scoreCache: "on-demand",
      publicScores: manifest.length,
      popScores: pop.length,
      bundledScores: manifest.length + pop.length,
      pianoSamples: piano.samples.length,
      pianoBytes,
      pianoLicenseChecked: true,
      nonRoot: true,
      readOnly: true,
      restrictedPermissions: true,
      popScoresChecked: true,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
