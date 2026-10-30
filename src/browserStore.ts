import { gzip, gunzip } from "fflate";
import type { Library } from "./model";
import type { PracticeSpan } from "./practiceTime";
let database: Promise<IDBDatabase>;
type CompressedLibrary = { encoding: "gzip-json-v1"; data: Uint8Array };
const libraryWrites = new Map<string, Promise<void>>();
let lastSavedLibrary: Library | undefined;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("qinxi-piano", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function read<T>(key: string): Promise<T | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("data").objectStore("data").get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function write<T>(key: string, value: T) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error("浏览器保存未完成"));
    tx.onerror = () => reject(tx.error);
  });
}
async function encodeLibrary(
  data: Library,
): Promise<Library | CompressedLibrary> {
  const estimatedBytes = data.songs.reduce(
    (total, song) => total + song.xml.length * 2 + song.notes.length * 200,
    0,
  );
  if (estimatedBytes <= 32 * 1024 * 1024) return data;
  const input = new TextEncoder().encode(JSON.stringify(data));
  const compressed = await new Promise<Uint8Array>((resolve, reject) =>
    gzip(input, { level: 4, consume: true }, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
  return { encoding: "gzip-json-v1", data: compressed };
}
function saveLibraryRecord(key: "library" | "before-scores", data: Library) {
  const next = (libraryWrites.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      if (key === "library" && lastSavedLibrary === data) return;
      if (key === "before-scores" && (await read(key))) return;
      await write(key, await encodeLibrary(data));
      if (key === "library") lastSavedLibrary = data;
    });
  libraryWrites.set(key, next);
  return next;
}
export async function loadBrowserLibrary() {
  const saved = await read<Library | CompressedLibrary>("library");
  if (saved && "encoding" in saved) {
    if (saved.encoding !== "gzip-json-v1") throw Error("曲库保存格式不受支持");
    const bytes = await new Promise<Uint8Array>((resolve, reject) =>
      gunzip(saved.data, { consume: true }, (error, result) =>
        error ? reject(error) : resolve(result),
      ),
    );
    return JSON.parse(new TextDecoder().decode(bytes)) as Library;
  }
  if (saved) return saved;
  const legacy = localStorage.getItem("qinxi-library");
  if (!legacy) return null;
  const data = JSON.parse(legacy) as Library;
  await saveBrowserLibrary(data);
  return data;
}
export const saveBrowserLibrary = (data: Library) =>
  saveLibraryRecord("library", data);
export const loadPracticeSpans = () => read<PracticeSpan[]>("practice-spans");
export const savePracticeSpans = (spans: PracticeSpan[]) =>
  write("practice-spans", spans);
export const backupBrowserLibrary = (data: Library) =>
  saveLibraryRecord("before-scores", data);
