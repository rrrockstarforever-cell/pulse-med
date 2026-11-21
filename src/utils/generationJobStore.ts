export type GenJob = {
  id: string;
  createdAt: number;
  updatedAt: number;
  status: 'running' | 'done';
  requestedCount: number;
  params: unknown;
  questions: unknown[];
};

const DB_NAME = 'pulse-gen-jobs';
const STORE = 'jobs';
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const CHECKPOINT_MS = 1500;

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        if (typeof indexedDB === 'undefined') {
          resolve(null);
          return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          try {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
              db.createObjectStore(STORE, { keyPath: 'id' });
            }
          } catch { /* ignore */ }
        };
        req.onsuccess = () => {
          try { resolve(req.result); } catch { resolve(null); }
        };
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

export async function saveGenJob(job: GenJob): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        try {
          tx.objectStore(STORE).put(job);
        } catch {
          resolve();
        }
      } catch {
        resolve();
      }
    });
  } catch { /* ignore */ }
}

export async function getUnfinishedGenJob(): Promise<GenJob | null> {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise<GenJob | null>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => {
          try {
            const cutoff = Date.now() - MAX_AGE_MS;
            const jobs = (req.result as GenJob[]).filter((j) =>
              j &&
              j.status === 'running' &&
              Array.isArray(j.questions) &&
              j.questions.length > 0 &&
              j.createdAt >= cutoff
            );
            jobs.sort((a, b) => b.createdAt - a.createdAt || b.updatedAt - a.updatedAt);
            resolve(jobs[0] ?? null);
          } catch {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
        tx.onerror = () => resolve(null);
        tx.onabort = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  } catch {
    return null;
  }
}

async function deleteGenJob(id: string): Promise<void> {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
        tx.onabort = () => resolve();
        try {
          tx.objectStore(STORE).delete(id);
        } catch {
          resolve();
        }
      } catch {
        resolve();
      }
    });
  } catch { /* ignore */ }
}

export async function completeGenJob(id: string): Promise<void> {
  try { await deleteGenJob(id); } catch { /* ignore */ }
}

export async function discardGenJob(id: string): Promise<void> {
  try { await deleteGenJob(id); } catch { /* ignore */ }
}

let pendingCheckpoint: GenJob | null = null;
let checkpointTimer: ReturnType<typeof setTimeout> | null = null;
let lastCheckpointAt = 0;

export function checkpointGenJob(job: GenJob): void {
  pendingCheckpoint = job;
  const now = Date.now();
  const elapsed = now - lastCheckpointAt;

  if (elapsed >= CHECKPOINT_MS) {
    if (checkpointTimer !== null) {
      clearTimeout(checkpointTimer);
      checkpointTimer = null;
    }
    const latest = pendingCheckpoint;
    pendingCheckpoint = null;
    if (latest) {
      lastCheckpointAt = now;
      try { void saveGenJob(latest); } catch { /* ignore */ }
    }
    return;
  }

  if (checkpointTimer !== null) return;
  const delay = Math.max(0, CHECKPOINT_MS - elapsed);
  checkpointTimer = setTimeout(() => {
    checkpointTimer = null;
    const latest = pendingCheckpoint;
    pendingCheckpoint = null;
    if (latest) {
      lastCheckpointAt = Date.now();
      try { void saveGenJob(latest); } catch { /* ignore */ }
    }
  }, delay);
}
