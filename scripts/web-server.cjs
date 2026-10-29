const http = require("node:http"),
  fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const root = path.resolve(__dirname, "../dist");
const port = Number(process.argv[process.argv.indexOf("--port") + 1]) || 4173;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".musicxml": "application/xml; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".mxl": "application/vnd.recordare.musicxml",
  ".mid": "audio/midi",
  ".midi": "audio/midi",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};
if (!fs.existsSync(path.join(root, "index.html")))
  throw Error("请先运行 npm run build");
const server = http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    response.writeHead(405);
    response.end();
    return;
  }
  let file;
  try {
    file = path.resolve(
      root,
      "." +
        decodeURIComponent(new URL(request.url, "http://localhost").pathname),
    );
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  if (file === root) file = path.join(root, "index.html");
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      "Content-Type": mime[path.extname(file)] || "application/octet-stream",
      "Content-Length": stat.size,
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Permissions-Policy": "midi=(self), fullscreen=(self)",
    });
    if (request.method === "HEAD") response.end();
    else fs.createReadStream(file).pipe(response);
  });
});
server.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
server.listen(port, "0.0.0.0", () => {
  console.log(`钢琴练习：http://localhost:${port}`);
  for (const [name, addresses] of Object.entries(os.networkInterfaces()))
    for (const entry of addresses || [])
      if (entry.family === "IPv4" && !entry.internal)
        console.log(`${name}：http://${entry.address}:${port}`);
});
