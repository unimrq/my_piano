import type { Library } from "./model";
let database: Promise<IDBDatabase>;
function open() {
  return (database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("qinxi-piano", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("data");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function read(key: string): Promise<Library | null> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction("data").objectStore("data").get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
}
async function write(key: string, value: Library) {
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("data", "readwrite");
    tx.objectStore("data").put(value, key);
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? Error("浏览器保存未完成"));
    tx.onerror = () => reject(tx.error);
  });
}
export async function loadBrowserLibrary() {
  const saved = await read("library");
  if (saved) return saved;
  const legacy = localStorage.getItem("qinxi-library");
  if (!legacy) return null;
  const data = JSON.parse(legacy) as Library;
  await write("library", data);
  return data;
}
export const saveBrowserLibrary = (data: Library) => write("library", data);
export async function backupBrowserLibrary(data: Library) {
  if (!(await read("before-scores"))) await write("before-scores", data);
}
