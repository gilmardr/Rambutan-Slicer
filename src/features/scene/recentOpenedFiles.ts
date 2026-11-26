/** The recent-files list (localStorage) and the bytes of each recent file (IndexedDB). */


export const RECENT_OPENED_FILES_STORAGE_KEY = 'app-recent-opened-files';
export const RECENT_OPENED_FILES_LIMIT = 10;
export const RECENT_FILES_DB_NAME = 'dragonfruit-recent-files';
export const RECENT_FILES_DB_VERSION = 1;
export const RECENT_FILES_STORE_NAME = 'files';

export type RecentOpenedFileKind = 'mesh' | 'scene';

export type RecentOpenedFileEntry = {
  id: string;
  name: string;
  kind: RecentOpenedFileKind;
  sourcePath?: string;
  sizeBytes?: number;
  openedAt: number;
};

export type RecentOpenedFileBlobRecord = {
  id: string;
  name: string;
  kind: RecentOpenedFileKind;
  sourcePath?: string;
  sizeBytes?: number;
  openedAt: number;
  type: string;
  lastModified: number;
  data: ArrayBuffer;
};

export function openRecentFilesDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(RECENT_FILES_DB_NAME, RECENT_FILES_DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(RECENT_FILES_STORE_NAME)) {
          db.createObjectStore(RECENT_FILES_STORE_NAME, { keyPath: 'id' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function putRecentOpenedFileBlob(entry: RecentOpenedFileEntry, file: File): Promise<void> {
  const db = await openRecentFilesDb();
  if (!db) return;

  try {
    const data = await file.arrayBuffer();

    const record: RecentOpenedFileBlobRecord = {
      id: entry.id,
      name: entry.name,
      kind: entry.kind,
      sourcePath: entry.sourcePath,
      sizeBytes: entry.sizeBytes,
      openedAt: entry.openedAt,
      type: file.type,
      lastModified: file.lastModified,
      data,
    };

    await new Promise<void>((resolve) => {
      const tx = db.transaction(RECENT_FILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RECENT_FILES_STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } catch {
    // ignore
  } finally {
    db.close();
  }
}

export async function deleteRecentOpenedFileBlobs(ids: string[]): Promise<void> {
  if (ids.length === 0) return;

  const db = await openRecentFilesDb();
  if (!db) return;

  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(RECENT_FILES_STORE_NAME, 'readwrite');
      const store = tx.objectStore(RECENT_FILES_STORE_NAME);
      ids.forEach((id) => store.delete(id));
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
  } finally {
    db.close();
  }
}

export async function readRecentOpenedFileBlob(entry: RecentOpenedFileEntry): Promise<File | null> {
  const db = await openRecentFilesDb();
  if (!db) return null;

  try {
    return await new Promise<File | null>((resolve) => {
      const tx = db.transaction(RECENT_FILES_STORE_NAME, 'readonly');
      const store = tx.objectStore(RECENT_FILES_STORE_NAME);
      const request = store.get(entry.id);

      request.onsuccess = () => {
        const result = request.result as RecentOpenedFileBlobRecord | undefined;
        if (!result || !(result.data instanceof ArrayBuffer)) {
          resolve(null);
          return;
        }

        const blob = new Blob([result.data], { type: result.type || '' });
        resolve(new File([blob], result.name || entry.name, {
          type: result.type || '',
          lastModified: Number.isFinite(result.lastModified) ? result.lastModified : Date.now(),
        }));
      };

      request.onerror = () => resolve(null);
      tx.onerror = () => resolve(null);
      tx.onabort = () => resolve(null);
    });
  } finally {
    db.close();
  }
}

export function readRecentOpenedFilesFromLocalStorage(): RecentOpenedFileEntry[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(RECENT_OPENED_FILES_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item): RecentOpenedFileEntry | null => {
        if (!item || typeof item !== 'object') return null;

        const id = typeof item.id === 'string' ? item.id.trim() : '';
        const name = typeof item.name === 'string' ? item.name : '';
        const kind = item.kind === 'mesh' || item.kind === 'scene' ? item.kind : null;
        const sourcePath = typeof item.sourcePath === 'string' && item.sourcePath.trim().length > 0
          ? item.sourcePath.trim()
          : undefined;
        const openedAt = Number(item.openedAt);
        const sizeBytes = typeof item.sizeBytes === 'number' && Number.isFinite(item.sizeBytes) && item.sizeBytes >= 0
          ? item.sizeBytes
          : undefined;

        if (!id || !name || !kind || !Number.isFinite(openedAt)) return null;

        return {
          id,
          name,
          kind,
          sourcePath,
          sizeBytes,
          openedAt,
        };
      })
      .filter((item): item is RecentOpenedFileEntry => item !== null)
      .slice(0, RECENT_OPENED_FILES_LIMIT);
  } catch {
    return [];
  }
}

export function writeRecentOpenedFilesToLocalStorage(entries: RecentOpenedFileEntry[]): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(RECENT_OPENED_FILES_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore
  }
}
