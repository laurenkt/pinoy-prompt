// A second copy of saved progress in IndexedDB.
//
// localStorage is the main copy because it can be read synchronously, but a
// single key is a single point of failure: it can be left unreadable, fail to
// save when storage is full, or lose recent writes when iOS kills the app
// before flushing. Every save is mirrored here too, and on start-up the newer
// of the two copies wins (see store.ts).

const DB_NAME = 'pinoy-prompt';
const STORE = 'progress';
const KEY = 'current';

let db: Promise<IDBDatabase> | null = null;
let pending: string | null = null;
let writing: Promise<void> | null = null;

function open(): Promise<IDBDatabase> {
  if (!db) {
    db = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE);
      request.onsuccess = () => {
        const opened = request.result;
        // Another tab upgrading the database needs this one to let go.
        opened.onversionchange = () => {
          opened.close();
          db = null;
        };
        resolve(opened);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('blocked'));
    });
    db.catch(() => {
      db = null;
    });
  }
  return db;
}

function available(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    // Reading indexedDB throws where storage is blocked.
    return false;
  }
}

/** The mirrored copy, or null if there is none or it can't be read in time. */
export async function readMirror(timeoutMs = 1500): Promise<string | null> {
  if (!available()) return null;
  const read = open().then(
    (database) =>
      new Promise<string | null>((resolve, reject) => {
        const request = database.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
        request.onsuccess = () => resolve(typeof request.result === 'string' ? request.result : null);
        request.onerror = () => reject(request.error);
      }),
  );
  // Some iOS versions leave IndexedDB requests hanging; don't hold up start-up for it.
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  try {
    return await Promise.race([read, timeout]);
  } catch {
    return null;
  }
}

/** Mirror a saved copy. Writes happen in order; only the latest pending one is kept. */
export function writeMirror(text: string): void {
  if (!available()) return;
  pending = text;
  writing ??= flush();
}

async function flush(): Promise<void> {
  try {
    await drain();
  } finally {
    // Cleared in the same tick the queue is found empty, so a write that
    // arrives just after starts a new flush instead of waiting on this one.
    writing = null;
  }
}

async function drain(): Promise<void> {
  while (pending !== null) {
    const text = pending;
    pending = null;
    try {
      const database = await open();
      await new Promise<void>((resolve, reject) => {
        const tx = database.transaction(STORE, 'readwrite', { durability: 'strict' });
        tx.objectStore(STORE).put(text, KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // The localStorage copy still stands; the next save tries again.
    }
  }
}

/** Resolves once every mirrored write so far has finished. For tests. */
export async function mirrorSettled(): Promise<void> {
  while (writing) await writing;
}

/** Forget the open connection, so a test can swap in a fresh IndexedDB. */
export function resetMirrorForTests(): void {
  db = null;
  pending = null;
  writing = null;
}
