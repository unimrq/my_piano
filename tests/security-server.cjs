const fs = require("node:fs/promises"),
  path = require("node:path"),
  http = require("node:http"),
  assert = require("node:assert/strict"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const request = (port, url, method = "GET") =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: url, method },
      (res) => {
        let data = "";
        res.on("data", (d) => (data += d));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, data }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
(async () => {
  const dir = await fs.mkdtemp(path.join(root, "test-results/security-"));
  await fs.mkdir(path.join(dir, "scripts"));
  await fs.mkdir(path.join(dir, "dist"));
  await fs.mkdir(path.join(dir, "outside"));
  await fs.copyFile(
    path.join(root, "scripts/web-server.cjs"),
    path.join(dir, "scripts/web-server.cjs"),
  );
  await fs.writeFile(path.join(dir, "dist/index.html"), "PUBLIC");
  await fs.writeFile(path.join(dir, "outside/secret.txt"), "PRIVATE_SENTINEL");
  await fs.writeFile(path.join(dir, "dist/.env"), "SECRET_ENV");
  await fs.symlink(
    path.join(dir, "outside"),
    path.join(dir, "dist/link"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const port = 19473,
    child = spawn(
      process.execPath,
      [path.join(dir, "scripts/web-server.cjs"), "--port", String(port)],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
  let errors = "";
  child.stderr.on("data", (d) => (errors += d));
  try {
    await new Promise((resolve, reject) => {
      child.stdout.once("data", resolve);
      child.once("error", reject);
      child.once("exit", (c) => reject(Error("server exited " + c + errors)));
    });
    const good = await request(port, "/");
    assert.equal(good.status, 200);
    assert.equal(good.headers["x-frame-options"], "DENY");
    assert.match(
      good.headers["content-security-policy"],
      /frame-ancestors 'none'/,
    );
    const attacks = [
      "/%00",
      "/%GG",
      "/%5c..%5coutside%5csecret.txt",
      "/%2e%2e%2foutside%2fsecret.txt",
      "/..%2foutside/secret.txt",
      "/.env",
      "/index.html::$DATA",
      "/link/secret.txt",
      "/%252e%252e/outside/secret.txt",
    ];
    for (const url of attacks) {
      const result = await request(port, url);
      assert(
        [400, 403, 404].includes(result.status),
        url + " " + result.status,
      );
      assert(!result.data.includes("PRIVATE_SENTINEL"));
      assert(!result.data.includes("SECRET_ENV"));
      assert.equal((await request(port, "/")).status, 200, "服务应保持可用");
    }
    assert.equal((await request(port, "/", "POST")).status, 405);
    const head = await request(port, "/", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.data, "");
    assert.equal(errors, "");
    console.log(
      JSON.stringify({
        traversalAndMalformedPaths: attacks.length,
        symlinkEscapeBlocked: true,
        head: true,
        postRejected: true,
        serverSurvived: true,
        securityHeaders: true,
        passed: true,
      }),
    );
  } finally {
    child.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
