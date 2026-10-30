import { defineConfig } from "vite";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
export default defineConfig({
  base: "./",
  plugins: [
    react(),
    {
      name: "qinxi-offline",
      apply: "build",
      async closeBundle() {
        await fs.mkdir("dist/licenses", { recursive: true });
        for (const file of [
          "LICENSE",
          "LICENSE.upstream",
          "LICENSES.third-party.txt",
          "NOTICE.md",
        ])
          await fs.copyFile(file, path.join("dist/licenses", file));
        const files = (
          await fs.readdir("dist", { recursive: true, withFileTypes: true })
        )
          .filter((file) => file.isFile() && file.name !== "sw.js")
          .map((file) =>
            path
              .relative("dist", path.join(file.parentPath, file.name))
              .replaceAll("\\", "/"),
          )
          .sort();
        const hash = createHash("sha256");
        for (const file of files)
          hash.update(await fs.readFile(path.join("dist", file)));
        const worker = (await fs.readFile("public/sw.js", "utf8"))
          .replace("__BUILD_ID__", hash.digest("hex").slice(0, 16))
          .replace(
            '["__PRECACHE_FILES__"]',
            JSON.stringify(
              files
                .filter(
                  (file) =>
                    !/^catalogue\/.*\.(mid|midi|xml|musicxml|mxl)$/i.test(file),
                )
                .map((file) => "./" + file),
            ),
          );
        await fs.writeFile("dist/sw.js", worker);
      },
    },
  ],
  build: { chunkSizeWarningLimit: 2000 },
});
