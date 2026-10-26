import { put, add, all, del } from "./db.js";
export const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
export function category(file) {
  const t = file.type || "",
    e = (file.name.split(".").pop() || "").toLowerCase();
  if (t.startsWith("image/")) return "image";
  if (t.startsWith("video/")) return "video";
  if (t.startsWith("audio/")) return "audio";
  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(e))
    return "archive";
  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "html",
      "css",
      "scss",
      "json",
      "xml",
      "md",
      "py",
      "cpp",
      "c",
      "java",
      "php",
      "sql",
      "sh",
      "bat",
      "yml",
      "yaml",
    ].includes(e)
  )
    return "code";
  if (["csv", "xls", "xlsx", "ods"].includes(e)) return "spreadsheet";
  if (["ppt", "pptx", "odp"].includes(e)) return "presentation";
  if (["pdf", "doc", "docx", "odt", "rtf"].includes(e)) return "document";
  if (t.startsWith("text/")) return "text";
  return "unknown";
}
export const fmtSize = (n) => {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const u = ["KB", "MB", "GB", "TB", "PB"];
  let i = -1;
  do {
    n /= 1024;
    i++;
  } while (n >= 1024 && i < u.length - 1);
  return `${n.toFixed(n < 10 ? 1 : n < 100 ? 1 : 0)} ${u[i]}`;
};
export const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const escapeHTML = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (m) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[m],
  );
export async function hashFile(file, onProgress) {
  const worker = new Worker(
    new URL("./workers/hash.worker.js", import.meta.url),
    { type: "module" },
  );
  return new Promise(async (resolve, reject) => {
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      worker.terminate();
      fn(v);
    };
    worker.onmessage = (e) =>
      e.data.type === "progress"
        ? onProgress?.(e.data.progress)
        : e.data.error
          ? finish(reject, new Error(e.data.error))
          : finish(resolve, e.data.hash);
    worker.onerror = (e) =>
      finish(reject, new Error(e.message || "Hash worker failed"));
    try {
      const buf = await file.arrayBuffer();
      worker.postMessage({ buffer: buf }, [buf]);
    } catch (e) {
      finish(reject, e);
    }
  });
}
export async function logActivity(fileId, action, details = "") {
  await add("activity", { id: uid(), fileId, action, details, at: Date.now() });
}
export async function upsertSearchIndex(file) {
  const tokens = [file.name, file.extension, file.type, file.category]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .filter(Boolean);
  await put("searchIndex", { fileId: file.id, tokens });
}
export async function createCollection(name) {
  const c = { id: uid(), name: name.trim(), createdAt: Date.now() };
  await add("collections", c);
  return c;
}
export async function createTag(name) {
  const t = { id: uid(), name: name.trim(), createdAt: Date.now() };
  await add("tags", t);
  return t;
}
export async function attachTag(fileId, tagId) {
  await put("fileTags", { id: `${fileId}:${tagId}`, fileId, tagId });
}
export async function detachTag(fileId, tagId) {
  await del("fileTags", `${fileId}:${tagId}`);
}
export async function attachCollection(fileId, collectionId) {
  await put("collectionFiles", {
    id: `${collectionId}:${fileId}`,
    fileId,
    collectionId,
  });
}
export async function detachCollection(fileId, collectionId) {
  await del("collectionFiles", `${collectionId}:${fileId}`);
}
export async function readText(file, limit = 2_000_000) {
  return file.slice(0, limit).text();
}
export function supportsFSA() {
  return "showOpenFilePicker" in window;
}
export function supportsDirectoryPicker() {
  return "showDirectoryPicker" in window;
}
