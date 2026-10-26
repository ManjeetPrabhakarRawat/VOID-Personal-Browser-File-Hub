const DB_NAME = "void-file-hub";
const DB_VERSION = 4;

const schema = {
  files: {
    keyPath: "id",
    indexes: [
      ["name", "name"],
      ["type", "type"],
      ["category", "category"],
      ["extension", "extension"],
      ["addedAt", "addedAt"],
      ["modifiedAt", "modifiedAt"],
      ["lastAccessed", "lastAccessed"],
      ["hash", "hash"],
      ["favorite", "favorite"],
    ],
  },
  collections: {
    keyPath: "id",
    indexes: [
      ["name", "name"],
      ["createdAt", "createdAt"],
    ],
  },
  tags: { keyPath: "id", indexes: [["name", "name"]] },
  fileTags: {
    keyPath: "id",
    indexes: [
      ["fileId", "fileId"],
      ["tagId", "tagId"],
    ],
  },
  collectionFiles: {
    keyPath: "id",
    indexes: [
      ["fileId", "fileId"],
      ["collectionId", "collectionId"],
    ],
  },
  thumbnails: { keyPath: "id", indexes: [["fileId", "fileId"]] },
  tasks: {
    keyPath: "id",
    indexes: [
      ["status", "status"],
      ["createdAt", "createdAt"],
    ],
  },
  settings: { keyPath: "key" },
  activity: {
    keyPath: "id",
    indexes: [
      ["fileId", "fileId"],
      ["at", "at"],
    ],
  },
  searchIndex: {
    keyPath: "fileId",
    indexes: [["tokens", "tokens", { multiEntry: true }]],
  },
};

let openPromise;
function upgrade(db, oldVersion, tx) {
  for (const [name, spec] of Object.entries(schema)) {
    let store;
    if (!db.objectStoreNames.contains(name))
      store = db.createObjectStore(name, { keyPath: spec.keyPath });
    else store = tx.objectStore(name);
    for (const item of spec.indexes || []) {
      const [indexName, keyPath, options] = item;
      if (!store.indexNames.contains(indexName))
        store.createIndex(indexName, keyPath, options || { unique: false });
    }
  }
  if (oldVersion < 3) {
  }
}

function openDB() {
  if (!openPromise)
    openPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () =>
        upgrade(req.result, req.transaction.db.version, req.transaction);
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => db.close();
        resolve(db);
      };
      req.onerror = () =>
        reject(req.error || new Error("Unable to open local database"));
      req.onblocked = () =>
        reject(
          new Error(
            "Database upgrade is blocked by another tab. Close other VOID tabs and retry.",
          ),
        );
    });
  return openPromise;
}

function request(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction(store, mode);
        } catch (e) {
          reject(e);
          return;
        }
        let result;
        try {
          result = fn(tx.objectStore(store));
        } catch (e) {
          reject(e);
          return;
        }
        tx.oncomplete = () => resolve(result);
        tx.onerror = () =>
          reject(tx.error || new Error("Database transaction failed"));
        tx.onabort = () =>
          reject(tx.error || new Error("Database transaction aborted"));
      }),
  );
}

const get = (store, key) =>
  request(store, "readonly", (s) => {
    const r = s.get(key);
    r.onsuccess = () => {};
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
const all = (store) =>
  request(
    store,
    "readonly",
    (s) =>
      new Promise((res, rej) => {
        const r = s.getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
  );
const count = (store) =>
  request(
    store,
    "readonly",
    (s) =>
      new Promise((res, rej) => {
        const r = s.count();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }),
  );
const put = (store, value) => request(store, "readwrite", (s) => s.put(value));
const add = (store, value) => request(store, "readwrite", (s) => s.add(value));
const del = (store, key) => request(store, "readwrite", (s) => s.delete(key));
const clear = (store) => request(store, "readwrite", (s) => s.clear());
async function bulkPut(store, values) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"),
      os = tx.objectStore(store);
    for (const value of values) os.put(value);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
async function bulkDelete(store, keys) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite"),
      os = tx.objectStore(store);
    for (const key of keys) os.delete(key);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const uid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
function category(file) {
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
const fmtSize = (n) => {
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
const fmtDate = (d) =>
  d
    ? new Date(d).toLocaleString([], {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const escapeHTML = (s) =>
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
async function hashFile(file, onProgress) {
  const worker = new Worker("./js/workers/hash.worker.js");
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
async function logActivity(fileId, action, details = "") {
  await add("activity", { id: uid(), fileId, action, details, at: Date.now() });
}
async function upsertSearchIndex(file) {
  const tokens = [file.name, file.extension, file.type, file.category]
    .join(" ")
    .toLowerCase()
    .split(/[^a-z0-9._-]+/)
    .filter(Boolean);
  await put("searchIndex", { fileId: file.id, tokens });
}
async function createCollection(name) {
  const c = { id: uid(), name: name.trim(), createdAt: Date.now() };
  await add("collections", c);
  return c;
}
async function createTag(name) {
  const t = { id: uid(), name: name.trim(), createdAt: Date.now() };
  await add("tags", t);
  return t;
}
async function attachTag(fileId, tagId) {
  await put("fileTags", { id: `${fileId}:${tagId}`, fileId, tagId });
}
async function detachTag(fileId, tagId) {
  await del("fileTags", `${fileId}:${tagId}`);
}
async function attachCollection(fileId, collectionId) {
  await put("collectionFiles", {
    id: `${collectionId}:${fileId}`,
    fileId,
    collectionId,
  });
}
async function detachCollection(fileId, collectionId) {
  await del("collectionFiles", `${collectionId}:${fileId}`);
}
async function readText(file, limit = 2_000_000) {
  return file.slice(0, limit).text();
}
function supportsFSA() {
  return "showOpenFilePicker" in window;
}
function supportsDirectoryPicker() {
  return "showDirectoryPicker" in window;
}

const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const DEFAULT_SETTINGS = {
  appearance: "dark",
  accent: "violet",
  density: "comfortable",
  defaultView: "dashboard",
  showExtensions: true,
  confirmRemove: true,
  autoHash: true,
};
const state = {
  view: "dashboard",
  files: [],
  collections: [],
  tags: [],
  fileTags: [],
  collectionFiles: [],
  activities: [],
  settings: { ...DEFAULT_SETTINGS },
  search: "",
  sort: "addedAt",
  dir: "desc",
  filterType: "all",
  favoriteOnly: false,
  list: false,
  selected: new Set(),
  collectionId: null,
};
let activeObjectURLs = new Set();
const workspace = $("#workspace"),
  picker = $("#file-picker"),
  backdrop = $("#modal-backdrop"),
  modal = $("#modal");
const fileIcon = (f) =>
  ({
    image: "▧",
    video: "▶",
    audio: "♫",
    archive: "◇",
    code: "<>",
    document: "▤",
    text: "≡",
    spreadsheet: "▦",
    presentation: "▥",
    unknown: "•",
  })[f.category] || "•";
const toastStack = $("#toast-stack");

function toast(message, type = "info") {
  const el = document.createElement("div");
  el.className = `toast ${type}`;
  el.textContent = message;
  toastStack.append(el);
  setTimeout(() => el.remove(), 3500);
}
function objectURL(blob) {
  const u = URL.createObjectURL(blob);
  activeObjectURLs.add(u);
  return u;
}
function revokeURLs() {
  for (const u of activeObjectURLs) URL.revokeObjectURL(u);
  activeObjectURLs.clear();
}
function pageHead(title, sub, actions = "") {
  return `<div class="page-head"><div><div class="eyebrow">VOID / ${escapeHTML(title)}</div><h1>${escapeHTML(title)}</h1><p>${escapeHTML(sub)}</p></div><div class="page-actions">${actions}</div></div>`;
}
function stat(label, value, note) {
  return `<div class="stat"><span class="stat-label">${escapeHTML(label)}</span><strong class="stat-value">${value}</strong><small>${escapeHTML(note)}</small></div>`;
}
function empty(title, text, actionLabel = "", action = "") {
  return `<div class="empty"><div class="empty-icon">◌</div><h3>${escapeHTML(title)}</h3><p>${escapeHTML(text)}</p>${actionLabel ? `<button class="primary-btn" data-action="${escapeHTML(action)}">${escapeHTML(actionLabel)}</button>` : ""}</div>`;
}
function getCollectionIds(fileId) {
  return state.collectionFiles
    .filter((x) => x.fileId === fileId)
    .map((x) => x.collectionId);
}
function getTagIds(fileId) {
  return state.fileTags.filter((x) => x.fileId === fileId).map((x) => x.tagId);
}
function tagsFor(fileId) {
  return getTagIds(fileId)
    .map((id) => state.tags.find((t) => t.id === id))
    .filter(Boolean);
}
function collectionNames(fileId) {
  return getCollectionIds(fileId)
    .map((id) => state.collections.find((c) => c.id === id))
    .filter(Boolean);
}
function displayName(f) {
  if (state.settings.showExtensions || !f.extension) return f.name;
  const suffix = `.${f.extension}`;
  return f.name.toLowerCase().endsWith(suffix.toLowerCase())
    ? f.name.slice(0, -suffix.length)
    : f.name;
}

async function loadSettings() {
  const records = await all("settings");
  for (const record of records) {
    if (record?.key in DEFAULT_SETTINGS)
      state.settings[record.key] = record.value;
  }
  applySettings();
}
async function saveSetting(key, value) {
  state.settings[key] = value;
  await put("settings", { key, value });
  applySettings();
}
function applySettings() {
  document.documentElement.dataset.theme = state.settings.appearance;
  document.documentElement.dataset.accent = state.settings.accent;
  document.documentElement.dataset.density = state.settings.density;
}
async function resetPreferences() {
  for (const key of Object.keys(DEFAULT_SETTINGS)) await del("settings", key);
  state.settings = { ...DEFAULT_SETTINGS };
  applySettings();
  toast("Preferences reset to defaults.");
  render();
}

async function refreshData() {
  const [files, collections, tags, fileTags, collectionFiles, activities] =
    await Promise.all([
      all("files"),
      all("collections"),
      all("tags"),
      all("fileTags"),
      all("collectionFiles"),
      all("activity"),
    ]);
  state.files = files.map((f) => ({ ...f }));
  state.collections = collections;
  state.tags = tags;
  state.fileTags = fileTags;
  state.collectionFiles = collectionFiles;
  state.activities = activities;
  $("#count-files").textContent = state.files.length;
  $("#count-favorites").textContent = state.files.filter(
    (f) => f.favorite,
  ).length;
  await updateStorageMini();
}
async function updateStorageMini() {
  try {
    const x = await navigator.storage?.estimate?.();
    $("#storage-mini").textContent = x
      ? `${fmtSize(x.usage || 0)} / ${fmtSize(x.quota || 0)}`
      : "Unavailable";
  } catch {
    $("#storage-mini").textContent = "Unavailable";
  }
}
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {}
}
function setView(view, extra = {}) {
  state.view = view;
  state.collectionId = null;
  Object.assign(state, extra);
  if (view !== "files") state.search = "";
  state.selected.clear();
  $$(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view),
  );
  $("#breadcrumb").textContent =
    view === "files" ? "All Files" : view[0].toUpperCase() + view.slice(1);
  render().catch(showError);
}
function showError(err) {
  console.error(err);
  workspace.innerHTML = `${pageHead("Something went wrong", "VOID could not render this view.", '<button class="secondary-btn" data-action="reload">Reload</button>')}${empty("Operation failed", err?.message || "An unexpected error occurred.")}`;
}

function searchFiles() {
  let a = [...state.files];
  const q = state.search.trim().toLowerCase();
  if (q)
    a = a.filter((f) =>
      [
        f.name,
        f.type,
        f.extension,
        f.category,
        ...tagsFor(f.id).map((t) => t.name),
        ...collectionNames(f.id).map((c) => c.name),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  if (state.filterType !== "all")
    a = a.filter((f) => f.category === state.filterType);
  if (state.favoriteOnly) a = a.filter((f) => f.favorite);
  if (state.collectionId)
    a = a.filter((f) => getCollectionIds(f.id).includes(state.collectionId));
  if (state.view === "duplicates")
    a = a.filter(
      (f) => f.hash && state.files.filter((x) => x.hash === f.hash).length > 1,
    );
  const dir = state.dir === "asc" ? 1 : -1;
  const val = (f) =>
    state.sort === "name"
      ? f.name.toLowerCase()
      : state.sort === "size"
        ? f.size
        : state.sort === "type"
          ? f.category
          : state.sort === "modifiedAt"
            ? f.modifiedAt
            : f.addedAt;
  if (state.view === "recent" && !state.search)
    a.sort((x, y) => (y.lastAccessed || 0) - (x.lastAccessed || 0));
  else
    a.sort((x, y) => {
      const A = val(x),
        B = val(y);
      return A < B ? -1 * dir : A > B ? 1 * dir : 0;
    });
  return a;
}

function dashboard() {
  const total = state.files.length,
    size = fmtSize(state.files.reduce((n, f) => n + f.size, 0)),
    fav = state.files.filter((f) => f.favorite).length;
  const recent = [...state.files]
    .sort((a, b) => (b.lastAccessed || 0) - (a.lastAccessed || 0))
    .slice(0, 6);
  const cats = [
    "image",
    "video",
    "audio",
    "document",
    "code",
    "archive",
    "spreadsheet",
    "presentation",
    "unknown",
  ];
  const counts = Object.fromEntries(
    cats.map((c) => [c, state.files.filter((f) => f.category === c).length]),
  );
  const max = Math.max(1, ...Object.values(counts));
  return (
    pageHead("Dashboard", "Your private browser workspace") +
    `<div class="stat-grid">${stat("Indexed files", total, "Real IndexedDB records")}${stat("Managed size", size, "Actual indexed file sizes")}${stat("Favorites", fav, "Saved locally")}${stat("Collections", state.collections.length, "Logical groups")}</div>` +
    `<div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Library composition</h3><span class="muted">${total} files</span></div><div class="panel-body"><div class="type-bars">${cats.map((c) => `<div class="bar-row"><span>${c}</span><div class="bar"><i style="width:${(counts[c] / max) * 100}%"></i></div><b>${counts[c]}</b></div>`).join("")}</div></div></section>` +
    `<section class="panel"><div class="panel-head"><h3>Quick actions</h3></div><div class="panel-body quick-actions"><button class="secondary-btn" data-action="directory">Import folder</button><button class="secondary-btn" data-action="collection">Create collection</button><button class="secondary-btn" data-view="duplicates">Find duplicates</button><button class="secondary-btn" data-view="files">Browse files</button><button class="secondary-btn" data-view="storage">Storage management</button><div class="privacy-callout"><span class="dot"></span><div><strong>Local-first</strong><small>Use the single Import button in the top bar to add files.</small></div></div></div></section></div>` +
    `<section class="panel" style="margin-top:14px"><div class="panel-head"><h3>Recent activity</h3><button class="secondary-btn" data-view="recent">View all</button></div><div class="panel-body">${recent.length ? `<div class="activity-list">${recent.map(activityItem).join("")}</div>` : empty("No recent activity", "Imported or opened files will appear here.")}</div></section>`
  );
}
function activityItem(f) {
  return `<div class="activity"><div class="file-icon">${fileIcon(f)}</div><div class="activity-main"><strong>${escapeHTML(displayName(f))}</strong><small>${escapeHTML(f.category)} · ${fmtSize(f.size)} · ${fmtDate(f.lastAccessed || f.addedAt)}</small></div><button class="icon-btn" data-preview="${f.id}" aria-label="Open ${escapeHTML(f.name)}">↗</button></div>`;
}

function explorer() {
  const arr = searchFiles();
  const types = [
    "all",
    "image",
    "video",
    "audio",
    "document",
    "code",
    "archive",
    "spreadsheet",
    "presentation",
    "unknown",
  ];
  const title =
    state.view === "files"
      ? "All Files"
      : state.view === "recent"
        ? "Recent"
        : state.view === "favorites"
          ? "Favorites"
          : state.collectionId
            ? state.collections.find((c) => c.id === state.collectionId)
                ?.name || "Collection"
            : "Files";
  const subtitle = state.search
    ? `${arr.length} matching files`
    : state.view === "favorites"
      ? "Your saved local files"
      : state.view === "recent"
        ? "Your recently opened or imported files"
        : state.collectionId
          ? "Files in this collection"
          : "Your indexed local library";
  const emptyAction = state.search
    ? ["Clear search", "clear-search"]
    : state.favoriteOnly
      ? ["Browse all files", "browse-files"]
      : state.view === "recent"
        ? ["Browse all files", "browse-files"]
        : state.collectionId
          ? ["Back to All Files", "browse-files"]
          : ["", ""];
  return (
    pageHead(
      title,
      subtitle,
      `<button class="secondary-btn" data-action="directory">＋ Folder</button>`,
    ) +
    `<div class="toolbar"><div class="filter-group"><select class="select" id="sort"><option value="addedAt">Date added</option><option value="modifiedAt">Modified</option><option value="name">Name</option><option value="size">Size</option><option value="type">Type</option></select><select class="select" id="type-filter">${types.map((t) => `<option value="${t}">${t === "all" ? "All types" : t}</option>`).join("")}</select><button class="secondary-btn ${state.favoriteOnly ? "active" : ""}" data-action="favorite-filter">☆ Favorites</button></div><div class="spacer"></div>${state.selected.size ? `<span class="selection-count">${state.selected.size} selected</span><button class="secondary-btn" data-action="bulk-favorite">★ Favorite</button><button class="secondary-btn" data-action="bulk-tag">Tag</button><button class="secondary-btn" data-action="bulk-collection">Collect</button><button class="danger-btn" data-action="bulk-delete">Remove</button>` : ""}<button class="secondary-btn" data-action="toggle-view">${state.list ? "▦ Grid" : "☷ List"}</button></div>` +
    `${arr.length ? (state.list ? listView(arr) : `<div class="file-grid">${arr.map(card).join("")}</div>`) : empty(state.search ? "No matching files" : state.favoriteOnly ? "No favorites yet" : state.view === "recent" ? "No recent files" : state.collectionId ? "Collection is empty" : "No files yet", state.search ? "Try a different search or clear it." : state.favoriteOnly ? "Mark a file as favorite from its card or preview." : state.view === "recent" ? "Files you open or import will appear here." : state.collectionId ? "Open All Files to organize files into this collection." : "Use the Import button in the top bar to add local files.", emptyAction[0], emptyAction[1])}`
  );
}
function selectionBox(f) {
  return `<input class="select-box" type="checkbox" data-select="${f.id}" ${state.selected.has(f.id) ? "checked" : ""} aria-label="Select ${escapeHTML(f.name)}">`;
}
function card(f) {
  const tags = tagsFor(f.id).slice(0, 2);
  const cols = collectionNames(f.id).slice(0, 1);
  return `<article class="file-card ${state.selected.has(f.id) ? "selected" : ""}"><div class="card-check">${selectionBox(f)}</div><button class="fav ${f.favorite ? "active" : ""}" data-fav="${f.id}" aria-label="${f.favorite ? "Unfavorite" : "Favorite"}">${f.favorite ? "★" : "☆"}</button><div class="thumb" data-preview="${f.id}" data-media-category="${f.category}">${fileIcon(f)}</div><div class="card-info" data-preview="${f.id}"><div class="card-name" title="${escapeHTML(f.name)}">${escapeHTML(displayName(f))}</div><div class="card-meta">${escapeHTML(f.category)} · ${fmtSize(f.size)} · ${fmtDate(f.addedAt)}</div><div class="chips">${tags.map((t) => `<span>${escapeHTML(t.name)}</span>`).join("")}${cols.map((c) => `<span>${escapeHTML(c.name)}</span>`).join("")}</div></div></article>`;
}
function listView(arr) {
  return `<div class="panel table-wrap"><table class="list"><thead><tr><th></th><th>Name</th><th>Type</th><th>Size</th><th>Modified</th><th>Added</th><th>Group</th><th></th></tr></thead><tbody>${arr.map((f) => `<tr><td>${selectionBox(f)}</td><td><button class="table-file" data-preview="${f.id}"><span class="file-icon">${fileIcon(f)}</span><span>${escapeHTML(displayName(f))}</span></button></td><td>${escapeHTML(f.category)}</td><td>${fmtSize(f.size)}</td><td>${fmtDate(f.modifiedAt)}</td><td>${fmtDate(f.addedAt)}</td><td>${escapeHTML(collectionNames(f.id)[0]?.name || "—")}</td><td><button class="icon-btn" data-fav="${f.id}" aria-label="${f.favorite ? "Unfavorite" : "Favorite"}">${f.favorite ? "★" : "☆"}</button></td></tr>`).join("")}</tbody></table></div>`;
}

async function collections() {
  return (
    pageHead(
      "Collections",
      "Organize files without duplicating content",
      `<button class="primary-btn" data-action="collection">＋ New collection</button>`,
    ) +
    `<div class="collection-grid">${
      state.collections.length
        ? state.collections
            .map((c) => {
              const count = state.collectionFiles.filter(
                (x) => x.collectionId === c.id,
              ).length;
              return `<div class="collection"><div class="collection-icon">▣</div><h3>${escapeHTML(c.name)}</h3><p>${count} file${count !== 1 ? "s" : ""} · created ${fmtDate(c.createdAt)}</p><div class="toolbar"><button class="secondary-btn" data-collection-view="${c.id}">Open</button><button class="danger-btn" data-delete-collection="${c.id}">Delete</button></div></div>`;
            })
            .join("")
        : empty(
            "No collections",
            "Create a logical group for related files.",
            "Create collection",
            "collection",
          )
    }</div>`
  );
}
function tagsPage() {
  return (
    pageHead(
      "Tags",
      "Local labels for faster search",
      `<button class="primary-btn" data-action="tag">＋ New tag</button>`,
    ) +
    `<div class="tag-grid">${
      state.tags.length
        ? state.tags
            .map((t) => {
              const count = state.fileTags.filter(
                (x) => x.tagId === t.id,
              ).length;
              return `<div class="tag-card"><strong>${escapeHTML(t.name)}</strong><span>${count} file${count !== 1 ? "s" : ""}</span><button class="icon-btn" data-delete-tag="${t.id}" aria-label="Delete ${escapeHTML(t.name)}">×</button></div>`;
            })
            .join("")
        : empty(
            "No tags",
            "Create labels and assign them from a file preview.",
            "Create tag",
            "tag",
          )
    }</div>`
  );
}
function duplicates() {
  const groups = new Map();
  for (const f of state.files)
    if (f.hash) {
      if (!groups.has(f.hash)) groups.set(f.hash, []);
      groups.get(f.hash).push(f);
    }
  const dup = [...groups.entries()].filter(([, g]) => g.length > 1);
  return (
    pageHead(
      "Duplicates",
      "Exact content matches based on SHA-256",
      `<button class="secondary-btn" data-action="scan-duplicates">Scan library</button>`,
    ) +
    `<div class="duplicate-list">${dup.length ? dup.map(([hash, g], i) => `<section class="panel duplicate-group"><div class="panel-head"><div><h3>Duplicate group ${i + 1}</h3><span class="muted">${g.length} identical files · ${fmtSize(g.reduce((s, f) => s + f.size, 0))} total</span></div><span class="hash">${hash.slice(0, 16)}…</span></div><div class="panel-body"><div class="activity-list">${g.map((f) => activityItem(f)).join("")}</div></div></section>`).join("") : empty("No exact duplicates", "Run a SHA-256 scan to check imported files for identical bytes.", "Scan library", "scan-duplicates")}</div>`
  );
}

async function storage() {
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const total = state.files.reduce((s, f) => s + f.size, 0);
  const largest = [...state.files].sort((a, b) => b.size - a.size).slice(0, 8);
  const cats = {};
  for (const f of state.files)
    cats[f.category] = (cats[f.category] || 0) + f.size;
  const entries = Object.entries(cats).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map((x) => x[1]));
  return (
    pageHead(
      "Storage",
      "Actual library size, browser quota and cleanup controls",
    ) +
    `<div class="stat-grid">${stat("Indexed file size", fmtSize(total), "Sum of file records")}${stat("Browser usage", est ? fmtSize(est.usage || 0) : "Unavailable", "navigator.storage.estimate()")}${stat("Browser quota", est ? fmtSize(est.quota || 0) : "Unavailable", "Browser-managed")}${stat("Available estimate", est ? fmtSize(Math.max(0, (est.quota || 0) - (est.usage || 0))) : "Unavailable", "Quota minus usage")}</div>` +
    `<div class="dashboard-grid"><section class="panel"><div class="panel-head"><h3>Category distribution</h3></div><div class="panel-body"><div class="type-bars">${entries.length ? entries.map(([c, n]) => `<div class="bar-row"><span>${escapeHTML(c)}</span><div class="bar"><i style="width:${(n / max) * 100}%"></i></div><b>${fmtSize(n)}</b></div>`).join("") : empty("No storage data", "Import files to calculate category usage.")}</div></div></section>` +
    `<section class="panel"><div class="panel-head"><h3>Largest files</h3></div><div class="panel-body">${largest.length ? largest.map((f) => `<div class="activity"><div class="file-icon">${fileIcon(f)}</div><div class="activity-main"><strong>${escapeHTML(displayName(f))}</strong><small>${fmtSize(f.size)} · ${escapeHTML(f.category)}</small></div></div>`).join("") : empty("No files", "Largest-file information will appear after you import files.")}</div></div></section></div>` +
    `<section class="panel" style="margin-top:14px"><div class="panel-head"><h3>Data management</h3></div><div class="panel-body"><div class="toolbar"><button class="secondary-btn" data-action="export">Export metadata</button><button class="danger-btn" data-action="clear-thumbs">Clear thumbnail cache</button><button class="danger-btn" data-action="clear-data">Clear VOID data</button></div><p class="muted note">Removing VOID records never deletes the original files from your computer.</p></div></section>`
  );
}

function settings() {
  const s = state.settings;
  return (
    pageHead(
      "Settings",
      "Customize how VOID looks, behaves and remembers your preferences",
    ) +
    `<div class="settings-grid">` +
    `<section class="panel"><div class="panel-head"><div><h3>Appearance</h3><span class="muted">Personalize the interface</span></div></div><div class="panel-body settings-body">` +
    settingSelect(
      "Appearance",
      "Choose the overall color mode.",
      "appearance",
      s.appearance,
      [
        ["dark", "Dark"],
        ["midnight", "Midnight"],
        ["light", "Light"],
      ],
    ) +
    settingSelect(
      "Accent color",
      "Choose the highlight color used across controls.",
      "accent",
      s.accent,
      [
        ["violet", "Violet"],
        ["cyan", "Cyan"],
        ["emerald", "Emerald"],
        ["amber", "Amber"],
        ["rose", "Rose"],
      ],
    ) +
    settingSelect(
      "Interface density",
      "Change spacing and card size.",
      "density",
      s.density,
      [
        ["comfortable", "Comfortable"],
        ["compact", "Compact"],
      ],
    ) +
    `</div></section>` +
    `<section class="panel"><div class="panel-head"><div><h3>Library behavior</h3><span class="muted">Control defaults and file handling</span></div></div><div class="panel-body settings-body">` +
    settingSelect(
      "Default page",
      "Choose the page shown when VOID opens.",
      "defaultView",
      s.defaultView,
      [
        ["dashboard", "Dashboard"],
        ["files", "All Files"],
        ["recent", "Recent"],
        ["favorites", "Favorites"],
        ["collections", "Collections"],
        ["tags", "Tags"],
        ["duplicates", "Duplicates"],
        ["storage", "Storage"],
      ],
    ) +
    settingToggle(
      "Show file extensions",
      "Keep the original filename visible on cards and lists.",
      "showExtensions",
      s.showExtensions,
    ) +
    settingToggle(
      "Confirm before removing",
      "Ask before removing records from VOID. Original files are never deleted.",
      "confirmRemove",
      s.confirmRemove,
    ) +
    settingToggle(
      "Automatic SHA-256 hashing",
      "Hash imported files for exact duplicate detection. Files larger than 250 MB are skipped automatically.",
      "autoHash",
      s.autoHash,
    ) +
    `</div></section>` +
    `<section class="panel"><div class="panel-head"><div><h3>Browser capabilities</h3><span class="muted">Detected on this device</span></div></div><div class="panel-body">` +
    capability(
      "File System Access API",
      "Browser file-system APIs detected.",
      supportsFSA(),
    ) +
    capability(
      "Directory picker",
      "Recursive folder import.",
      supportsDirectoryPicker(),
    ) +
    capability(
      "Offline shell",
      "Service worker support.",
      "serviceWorker" in navigator,
    ) +
    capability(
      "Local storage",
      "IndexedDB is used for library records.",
      true,
    ) +
    `<div class="setting"><div><h4>Privacy</h4><p>Imported file contents stay inside this browser profile. VOID has no account or upload service.</p></div><span class="badge success">Local-first</span></div>` +
    `</div></section>` +
    `<section class="panel"><div class="panel-head"><div><h3>Reset & data</h3><span class="muted">Manage local preferences and records</span></div></div><div class="panel-body">` +
    `<div class="setting"><div><h4>Reset preferences</h4><p>Return appearance and behavior options to their defaults. Your files and collections remain untouched.</p></div><button class="secondary-btn" data-action="reset-settings">Reset</button></div>` +
    `<div class="setting"><div><h4>Clear application data</h4><p>Remove all VOID records from IndexedDB. This does not delete original files from your computer.</p></div><button class="danger-btn" data-action="clear-data">Clear data</button></div>` +
    `</div></section>` +
    `</div>`
  );
}
function settingSelect(title, desc, key, value, options) {
  return `<div class="setting"><div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(desc)}</p></div><select class="select setting-control" data-setting="${key}">${options.map(([v, l]) => `<option value="${v}" ${v === value ? "selected" : ""}>${escapeHTML(l)}</option>`).join("")}</select></div>`;
}
function settingToggle(title, desc, key, value) {
  return `<div class="setting"><div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(desc)}</p></div><label class="switch"><input type="checkbox" data-setting="${key}" ${value ? "checked" : ""}><span></span></label></div>`;
}
function capability(title, desc, supported) {
  return `<div class="setting"><div><h4>${escapeHTML(title)}</h4><p>${escapeHTML(desc)}</p></div><span class="badge ${supported ? "success" : ""}">${supported ? "Supported" : "Fallback"}</span></div>`;
}

async function render() {
  revokeURLs();
  let html = "";
  if (state.view === "dashboard") html = dashboard();
  else if (state.view === "collections") html = await collections();
  else if (state.view === "tags") html = tagsPage();
  else if (state.view === "duplicates") html = duplicates();
  else if (state.view === "storage") html = await storage();
  else if (state.view === "settings") html = settings();
  else html = explorer();
  workspace.innerHTML = html;
  hydrateThumbnails();
  const s = $("#sort");
  if (s) s.value = state.sort;
  const t = $("#type-filter");
  if (t) t.value = state.filterType;
  updateSelectionUI();
}
function hydrateThumbnails() {
  $$(".thumb[data-media-category]").forEach((el) => {
    const f = state.files.find((x) => x.id === el.dataset.preview);
    if (!f || !f.file) return;
    if (f.category === "image") {
      const img = document.createElement("img");
      img.loading = "lazy";
      img.alt = "";
      img.src = objectURL(f.file);
      el.replaceChildren(img);
    } else if (f.category === "video") {
      const video = document.createElement("video");
      video.muted = true;
      video.playsInline = true;
      video.preload = "metadata";
      video.src = objectURL(f.file);
      video.addEventListener("loadeddata", () => {
        try {
          video.currentTime = 0;
        } catch {}
      });
      el.replaceChildren(video);
    }
  });
}
function updateSelectionUI() {
  const n = state.selected.size;
  $$("[data-select]").forEach(
    (x) => (x.checked = state.selected.has(x.dataset.select)),
  );
  $(".selection-count")?.replaceChildren(
    document.createTextNode(`${n} selected`),
  );
}

async function importFiles(files) {
  const list = [...files];
  if (!list.length) return;
  const task = {
    id: uid(),
    type: "import",
    status: "processing",
    createdAt: Date.now(),
    total: list.length,
    completed: 0,
    failed: 0,
  };
  await add("tasks", task);
  showTask(task);
  for (const file of list) {
    try {
      const record = {
        id: uid(),
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
        extension: (file.name.split(".").pop() || "").toLowerCase(),
        category: category(file),
        addedAt: Date.now(),
        modifiedAt: file.lastModified || Date.now(),
        lastAccessed: Date.now(),
        favorite: false,
        hash: null,
        storageMode: "browser-local",
        file,
      };
      await put("files", record);
      await upsertSearchIndex(record);
      await logActivity(record.id, "imported");
      if (state.settings.autoHash && file.size <= 250 * 1024 * 1024) {
        try {
          record.hash = await hashFile(file);
          await put("files", record);
        } catch (err) {
          console.warn("Hash failed", err);
        }
      }
    } catch (err) {
      task.failed++;
      console.error(err);
    } finally {
      task.completed++;
      updateTask(task, `${file.name} processed`);
    }
  }
  task.status = task.failed ? "completed-with-errors" : "completed";
  task.finishedAt = Date.now();
  await put("tasks", task);
  updateTask(
    task,
    task.failed ? `${task.failed} file(s) failed` : "Import complete",
  );
  await refreshData();
  render();
}
function showTask(task) {
  let el = $("#task-panel");
  if (!el) {
    el = document.createElement("aside");
    el.id = "task-panel";
    el.className = "task-panel";
    document.body.append(el);
  }
  el.innerHTML = `<div class="task-title"><strong>Importing files</strong><button class="icon-btn" data-action="close-task">×</button></div><div class="progress"><i style="width:${task.total ? (task.completed / task.total) * 100 : 0}%"></i></div><small id="task-status">0 / ${task.total} completed</small>`;
}
function updateTask(task, msg) {
  const el = $("#task-panel");
  if (!el) return;
  el.querySelector(".progress i").style.width =
    `${task.total ? (task.completed / task.total) * 100 : 0}%`;
  el.querySelector("#task-status").textContent =
    `${task.completed} / ${task.total} completed${task.failed ? ` · ${task.failed} failed` : ""}${msg ? ` · ${msg}` : ""}`;
  if (task.status.startsWith("completed")) setTimeout(() => el.remove(), 5000);
}
async function importDirectory() {
  if (!supportsDirectoryPicker()) {
    toast(
      "Folder import is not supported in this browser. Use the top Import button instead.",
      "error",
    );
    return;
  }
  try {
    const handle = await window.showDirectoryPicker();
    const files = [];
    const walk = async (dir) => {
      for await (const [, entry] of dir.entries()) {
        if (entry.kind === "file") files.push(await entry.getFile());
        else if (entry.kind === "directory") await walk(entry);
      }
    };
    await walk(handle);
    if (files.length) await importFiles(files);
    else toast("The selected folder contains no files.");
  } catch (err) {
    if (err.name !== "AbortError")
      toast(`Folder import failed: ${err.message || err}`, "error");
  }
}
async function toggleFavorite(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  f.favorite = !f.favorite;
  await put("files", f);
  await logActivity(f.id, f.favorite ? "favorited" : "unfavorited");
  await refreshData();
  render();
}
async function deleteFile(id, skipConfirm = false) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  if (
    !skipConfirm &&
    state.settings.confirmRemove &&
    !confirm(
      `Remove “${f.name}” from VOID? The original file on your computer will not be deleted.`,
    )
  )
    return;
  await del("files", id);
  await del("searchIndex", id);
  await bulkDelete(
    "fileTags",
    state.fileTags.filter((x) => x.fileId === id).map((x) => x.id),
  );
  await bulkDelete(
    "collectionFiles",
    state.collectionFiles.filter((x) => x.fileId === id).map((x) => x.id),
  );
  toast(`Removed ${f.name} from VOID.`);
  await refreshData();
  render();
}

async function openPreview(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  f.lastAccessed = Date.now();
  await put("files", f);
  const c = f.category;
  let body = "";
  if (c === "image")
    body = `<img class="preview-media" src="${objectURL(f.file)}" alt="${escapeHTML(f.name)}">`;
  else if (c === "video")
    body = `<video class="preview-media" src="${objectURL(f.file)}" controls playsinline></video>`;
  else if (c === "audio")
    body = `<audio class="preview-audio" src="${objectURL(f.file)}" controls></audio>`;
  else if (f.type === "application/pdf")
    body = `<iframe class="pdf-frame" title="PDF preview" src="${objectURL(f.file)}"></iframe>`;
  else if (c === "code" || c === "text" || f.type === "application/json")
    body = '<pre class="code-preview" id="text-preview">Loading…</pre>';
  else
    body = empty(
      "Preview unavailable",
      "This format cannot be safely rendered in the browser. The file record remains available.",
      "Close",
      "close",
    );
  modal.innerHTML = `<div class="modal-head"><div><strong>${escapeHTML(f.name)}</strong><small>${escapeHTML(f.type)} · ${fmtSize(f.size)}</small></div><button class="icon-btn" data-action="close-modal" aria-label="Close">×</button></div><div class="modal-content">${body}<div class="meta-grid"><div class="meta-item"><span>Type</span><strong>${escapeHTML(f.type)}</strong></div><div class="meta-item"><span>Extension</span><strong>.${escapeHTML(f.extension || "")}</strong></div><div class="meta-item"><span>Modified</span><strong>${fmtDate(f.modifiedAt)}</strong></div><div class="meta-item"><span>Added</span><strong>${fmtDate(f.addedAt)}</strong></div><div class="meta-item"><span>SHA-256</span><strong class="break">${f.hash || "Pending / unavailable"}</strong></div><div class="meta-item"><span>Favorite</span><strong>${f.favorite ? "Yes" : "No"}</strong></div></div><div class="modal-actions"><button class="secondary-btn" data-fav="${f.id}">${f.favorite ? "★ Unfavorite" : "☆ Favorite"}</button><button class="secondary-btn" data-action="manage-file" data-id="${f.id}">Organize</button><button class="danger-btn" data-action="delete-file" data-id="${f.id}">Remove from VOID</button></div></div>`;
  backdrop.classList.remove("hidden");
  if (c === "code" || c === "text" || f.type === "application/json")
    $("#text-preview").textContent = await readText(f.file);
}
function closeModal() {
  backdrop.classList.add("hidden");
  modal.innerHTML = "";
  revokeURLs();
}
async function manageFile(id) {
  const f = state.files.find((x) => x.id === id);
  if (!f) return;
  const tags = state.tags,
    cols = state.collections;
  modal.innerHTML = `<div class="modal-head"><div><strong>Organize file</strong><small>${escapeHTML(f.name)}</small></div><button class="icon-btn" data-action="close-modal">×</button></div><div class="modal-content"><label>Collection<select class="select full" id="manage-collection"><option value="">No collection</option>${cols.map((c) => `<option value="${c.id}" ${getCollectionIds(id).includes(c.id) ? "selected" : ""}>${escapeHTML(c.name)}</option>`).join("")}</select></label><div class="manage-tags"><strong>Tags</strong><div class="tag-checks">${tags.map((t) => `<label><input type="checkbox" data-manage-tag="${t.id}" ${getTagIds(id).includes(t.id) ? "checked" : ""}> ${escapeHTML(t.name)}</label>`).join("") || '<span class="muted">No tags yet. Create one from the Tags page.</span>'}</div></div><div class="modal-actions"><button class="primary-btn" data-action="save-organize" data-id="${id}">Save changes</button><button class="secondary-btn" data-action="close-modal">Cancel</button></div></div>`;
}
async function saveOrganize(id) {
  const desiredCollection = $("#manage-collection").value;
  for (const c of state.collections) {
    const has = getCollectionIds(id).includes(c.id);
    if (c.id === desiredCollection && !has) await attachCollection(id, c.id);
    if (c.id !== desiredCollection && has) await detachCollection(id, c.id);
  }
  for (const t of state.tags) {
    const input = $(`[data-manage-tag="${t.id}"]`);
    const has = getTagIds(id).includes(t.id);
    if (input?.checked && !has) await attachTag(id, t.id);
    if (input && !input.checked && has) await detachTag(id, t.id);
  }
  toast("File organization saved.");
  await refreshData();
  closeModal();
  render();
}
async function createCollectionPrompt() {
  const name = prompt("Collection name");
  if (!name?.trim()) return;
  try {
    await createCollection(name);
    await refreshData();
    render();
    toast("Collection created.");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function createTagPrompt() {
  const name = prompt("Tag name");
  if (!name?.trim()) return;
  try {
    await createTag(name);
    await refreshData();
    render();
    toast("Tag created.");
  } catch (e) {
    toast(e.message, "error");
  }
}
async function deleteCollection(id) {
  const c = state.collections.find((x) => x.id === id);
  if (!c) return;
  if (
    state.settings.confirmRemove &&
    !confirm(`Delete collection “${c.name}”? Files will not be deleted.`)
  )
    return;
  await del("collections", id);
  await bulkDelete(
    "collectionFiles",
    state.collectionFiles.filter((x) => x.collectionId === id).map((x) => x.id),
  );
  await refreshData();
  render();
  toast("Collection deleted.");
}
async function deleteTag(id) {
  const t = state.tags.find((x) => x.id === id);
  if (!t) return;
  if (state.settings.confirmRemove && !confirm(`Delete tag “${t.name}”?`))
    return;
  await del("tags", id);
  await bulkDelete(
    "fileTags",
    state.fileTags.filter((x) => x.tagId === id).map((x) => x.id),
  );
  await refreshData();
  render();
  toast("Tag deleted.");
}
function openCollection(id) {
  setView("files", { collectionId: id });
}
async function bulkAction(type) {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (type === "delete") {
    if (
      state.settings.confirmRemove &&
      !confirm(
        `Remove ${ids.length} selected record(s) from VOID? Original files are not deleted.`,
      )
    )
      return;
    for (const id of ids) await deleteFile(id, true);
    state.selected.clear();
    await refreshData();
    render();
    return;
  }
  if (type === "favorite") {
    for (const id of ids) {
      const f = state.files.find((x) => x.id === id);
      if (f && !f.favorite) {
        f.favorite = true;
        await put("files", f);
      }
    }
    toast("Selected files favorited.");
  }
  if (type === "tag") {
    const name = prompt("Tag name");
    if (!name?.trim()) return;
    let tag = state.tags.find(
      (t) => t.name.toLowerCase() === name.trim().toLowerCase(),
    );
    if (!tag) tag = await createTag(name);
    for (const id of ids) await attachTag(id, tag.id);
    toast("Tag assigned to selected files.");
  }
  if (type === "collection") {
    if (!state.collections.length) {
      await createCollectionPrompt();
      return;
    }
    const choices = state.collections
      .map((c, i) => `${i + 1}. ${c.name}`)
      .join("\n");
    const answer = prompt(`Choose collection number:\n${choices}`);
    const c = state.collections[Number(answer) - 1];
    if (!c) return;
    for (const id of ids) await attachCollection(id, c.id);
    toast("Selected files added to collection.");
  }
  state.selected.clear();
  await refreshData();
  render();
}
async function scanDuplicates() {
  toast("Scanning library…");
  for (const f of state.files.filter(
    (x) => !x.hash && x.file && x.size <= 250 * 1024 * 1024,
  )) {
    try {
      f.hash = await hashFile(f.file);
      await put("files", f);
    } catch (e) {
      console.warn(e);
    }
  }
  await refreshData();
  setView("duplicates");
  toast("Duplicate scan completed.");
}
async function exportMetadata() {
  const payload = {
    product: "VOID",
    version: 4,
    exportedAt: new Date().toISOString(),
    settings: state.settings,
    files: state.files.map(({ file, ...meta }) => meta),
    collections: state.collections,
    tags: state.tags,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const a = document.createElement("a");
  a.href = objectURL(blob);
  a.download = "void-metadata.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 500);
  toast("Metadata export created.");
}
async function clearData() {
  if (
    !confirm(
      "Clear all VOID application data? Original computer files will not be deleted.",
    )
  )
    return;
  for (const s of [
    "files",
    "collections",
    "tags",
    "fileTags",
    "collectionFiles",
    "thumbnails",
    "tasks",
    "settings",
    "activity",
    "searchIndex",
  ])
    await clear(s);
  state.selected.clear();
  state.settings = { ...DEFAULT_SETTINGS };
  applySettings();
  await refreshData();
  render();
  toast("VOID application data cleared.");
}
async function clearThumbs() {
  await clear("thumbnails");
  toast("Thumbnail cache cleared.");
  await refreshData();
}

picker.addEventListener("change", (e) => {
  const files = e.target.files;
  importFiles(files);
  picker.value = "";
});
document.addEventListener("click", async (e) => {
  try {
    const nav = e.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      return;
    }
    const action = e.target.closest("[data-action]");
    if (action) {
      const a = action.dataset.action;
      if (a === "import") {
        picker.click();
        return;
      }
      if (a === "directory") {
        await importDirectory();
        return;
      }
      if (a === "collection") {
        await createCollectionPrompt();
        return;
      }
      if (a === "tag") {
        await createTagPrompt();
        return;
      }
      if (a === "toggle-view") {
        state.list = !state.list;
        render();
        return;
      }
      if (a === "favorite-filter") {
        state.favoriteOnly = !state.favoriteOnly;
        render();
        return;
      }
      if (a === "bulk-favorite") {
        await bulkAction("favorite");
        return;
      }
      if (a === "bulk-tag") {
        await bulkAction("tag");
        return;
      }
      if (a === "bulk-collection") {
        await bulkAction("collection");
        return;
      }
      if (a === "bulk-delete") {
        await bulkAction("delete");
        return;
      }
      if (a === "scan-duplicates") {
        await scanDuplicates();
        return;
      }
      if (a === "export") {
        await exportMetadata();
        return;
      }
      if (a === "clear-data") {
        await clearData();
        return;
      }
      if (a === "clear-thumbs") {
        await clearThumbs();
        return;
      }
      if (a === "reset-settings") {
        await resetPreferences();
        return;
      }
      if (a === "clear-search") {
        state.search = "";
        $("#global-search").value = "";
        render();
        return;
      }
      if (a === "browse-files") {
        state.favoriteOnly = false;
        state.search = "";
        $("#global-search").value = "";
        setView("files");
        return;
      }
      if (a === "close-modal" || a === "close") {
        closeModal();
        return;
      }
      if (a === "delete-file") {
        await deleteFile(action.dataset.id);
        closeModal();
        return;
      }
      if (a === "manage-file") {
        await manageFile(action.dataset.id);
        return;
      }
      if (a === "save-organize") {
        await saveOrganize(action.dataset.id);
        return;
      }
      if (a === "close-task") {
        $("#task-panel")?.remove();
        return;
      }
      if (a === "reload") {
        location.reload();
        return;
      }
    }
    const fav = e.target.closest("[data-fav]");
    if (fav) {
      e.stopPropagation();
      await toggleFavorite(fav.dataset.fav);
      if (!backdrop.classList.contains("hidden")) openPreview(fav.dataset.fav);
      return;
    }
    const select = e.target.closest("[data-select]");
    if (select) {
      if (select.checked) state.selected.add(select.dataset.select);
      else state.selected.delete(select.dataset.select);
      updateSelectionUI();
      return;
    }
    const preview = e.target.closest("[data-preview]");
    if (preview) {
      await openPreview(preview.dataset.preview);
      return;
    }
    const cv = e.target.closest("[data-collection-view]");
    if (cv) {
      openCollection(cv.dataset.collectionView);
      return;
    }
    const dc = e.target.closest("[data-delete-collection]");
    if (dc) {
      await deleteCollection(dc.dataset.deleteCollection);
      return;
    }
    const dt = e.target.closest("[data-delete-tag]");
    if (dt) {
      await deleteTag(dt.dataset.deleteTag);
      return;
    }
  } catch (err) {
    console.error(err);
    toast(err.message || "Operation failed", "error");
  }
});

document.addEventListener("change", async (e) => {
  if (e.target.id === "sort") {
    state.sort = e.target.value;
    render();
    return;
  }
  if (e.target.id === "type-filter") {
    state.filterType = e.target.value;
    render();
    return;
  }
  const setting = e.target.dataset.setting;
  if (setting) {
    const value =
      e.target.type === "checkbox" ? e.target.checked : e.target.value;
    await saveSetting(setting, value);
    if (setting === "defaultView") {
      toast("Default page saved.");
    } else if (
      setting !== "appearance" &&
      setting !== "accent" &&
      setting !== "density"
    )
      toast("Setting saved.");
    if (
      setting === "appearance" ||
      setting === "accent" ||
      setting === "density"
    )
      render();
    return;
  }
});

let searchTimer;
$("#global-search").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  state.search = e.target.value;
  state.view = "files";
  state.favoriteOnly = false;
  state.collectionId = null;
  $$(".nav-item").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === "files"),
  );
  $("#breadcrumb").textContent = "All Files";
  searchTimer = setTimeout(render, 120);
});
$("#mobile-menu").addEventListener("click", () =>
  $("#sidebar").classList.toggle("open"),
);
document.addEventListener("click", (e) => {
  if (e.target.closest(".sidebar .nav-item"))
    $("#sidebar").classList.remove("open");
});
["dragenter", "dragover"].forEach((type) =>
  document.addEventListener(type, (e) => {
    if (e.dataTransfer?.types?.includes("Files")) {
      e.preventDefault();
      $("#drop-overlay").classList.add("active");
    }
  }),
);
document.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) {
    e.preventDefault();
    importFiles(e.dataTransfer.files);
  }
  $("#drop-overlay").classList.remove("active");
});
document.addEventListener("dragleave", (e) => {
  if (e.target === document.documentElement)
    $("#drop-overlay").classList.remove("active");
});
$("#modal-backdrop").addEventListener("click", (e) => {
  if (e.target === backdrop) closeModal();
});
document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
    e.preventDefault();
    picker.click();
  }
  if (e.key === "/" && document.activeElement?.tagName !== "INPUT") {
    e.preventDefault();
    $("#global-search").focus();
  }
  if (e.key === "Escape") {
    closeModal();
    $("#sidebar").classList.remove("open");
  }
});

async function init() {
  try {
    applySettings();
    workspace.innerHTML = dashboard();
  } catch (e) {
    showError(e);
    return;
  }
  try {
    await loadSettings();
    await refreshData();
    setView(state.settings.defaultView || "dashboard");
    requestPersistentStorage().catch(() => {});
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("./service-worker.js")
        .catch(console.warn);
  } catch (e) {
    console.error("VOID initialization failed:", e);
    showError(e);
  }
}
window.addEventListener("error", (e) => {
  console.error(e.error || e.message);
  if (workspace && !workspace.innerHTML.trim())
    showError(e.error || new Error(e.message || "Application error"));
});
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  if (workspace && !workspace.innerHTML.trim())
    showError(e.reason || new Error("Unexpected application error"));
});
init();
