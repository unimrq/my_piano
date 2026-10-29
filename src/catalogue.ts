import { importScore } from "./importer";
import type { Song } from "./model";
interface Entry {
  id: string;
  title: string;
  composer: string;
  difficulty: string;
  category: string;
  focus: string;
  file: string;
  license: string;
  attribution: string;
  sourceUrl: string;
  edition: string;
}
export async function loadCatalogue(): Promise<Song[]> {
  const response = await fetch("./catalogue/manifest.json");
  if (!response.ok) throw Error("内置曲库索引读取失败");
  const entries: Entry[] = await response.json();
  // Personal scores stay on this machine and are excluded from the source repository.
  const personal = Object.values(
    import.meta.glob<Entry[]>("./personal-catalogue.json", {
      eager: true,
      import: "default",
    }),
  ).flat();
  return Promise.all(
    [...personal, ...entries].map(async (entry) => {
      const response = await fetch("./catalogue/" + entry.file);
      if (!response.ok) throw Error("曲谱读取失败：" + entry.title);
      const song = importScore(
        entry.file,
        new Uint8Array(await response.arrayBuffer()),
      );
      return {
        ...song,
        id: entry.id,
        title: entry.title,
        source: "builtin" as const,
        composer: entry.composer,
        difficulty: entry.difficulty,
        category: entry.category,
        focus: entry.focus,
        license: entry.license,
        sourceUrl: entry.sourceUrl,
        edition: entry.edition,
        sourceInfo: `${entry.attribution} · ${entry.license}；${entry.edition}`,
      };
    }),
  );
}
