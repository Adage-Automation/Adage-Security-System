// Offline queueing for ENTRY/EXIT taps (spec §52, decided deliberately).
// A failed/offline submission is stored here and retried when connectivity
// returns. The guard's UI must show this as "pending sync", never as a
// confirmed save — we never report success before the server confirms it.
const DB_NAME = 'adage-security-offline';
const STORE_NAME = 'pending-movements';

export interface PendingMovement {
  localId: string;
  clientRequestId: string;
  userId: number;
  employeeId: number;
  employeeName: string;
  movementType: 'ENTRY' | 'EXIT';
  confirmed?: boolean;
  queuedAt: string;
  syncState?: 'pending' | 'conflict';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'localId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueueMovement(entry: Omit<PendingMovement, 'localId' | 'queuedAt'>): Promise<PendingMovement> {
  const db = await openDb();
  const pending: PendingMovement = {
    ...entry,
    localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    queuedAt: new Date().toISOString(),
    syncState: 'pending',
  };
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(pending);
    tx.oncomplete = () => resolve(pending);
    tx.onerror = () => reject(tx.error);
  });
}

export async function updatePendingMovement(localId: string, changes: Partial<PendingMovement>): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const request = store.get(localId);
    request.onsuccess = () => {
      if (request.result) store.put({ ...request.result, ...changes });
    };
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listPendingMovements(userId?: number): Promise<PendingMovement[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const entries = req.result as PendingMovement[];
      resolve(userId === undefined ? entries : entries.filter((entry) => entry.userId === userId));
    };
    req.onerror = () => reject(req.error);
  });
}

export async function removePendingMovement(localId: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(localId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
