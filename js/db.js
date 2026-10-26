const DB_NAME = "void-local";
const DB_VERSION = 3;

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

export function openDB() {
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

export const get = (store, key) =>
  request(store, "readonly", (s) => {
    const r = s.get(key);
    r.onsuccess = () => {};
    return new Promise((res, rej) => {
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  });
export const all = (store) =>
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
export const count = (store) =>
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
export const put = (store, value) =>
  request(store, "readwrite", (s) => s.put(value));
export const add = (store, value) =>
  request(store, "readwrite", (s) => s.add(value));
export const del = (store, key) =>
  request(store, "readwrite", (s) => s.delete(key));
export const clear = (store) => request(store, "readwrite", (s) => s.clear());
export async function bulkPut(store, values) {
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
export async function bulkDelete(store, keys) {
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
