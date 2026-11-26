'use no memo';
/**
 * The recent-files list: its state, the read from localStorage on mount, and
 * the calls that record opened files and clear the list (the bytes of each
 * file are kept in IndexedDB). Part of useSceneCollectionManager.
 */
import { useCallback, useEffect, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
  RECENT_OPENED_FILES_LIMIT,
  deleteRecentOpenedFileBlobs,
  putRecentOpenedFileBlob,
  readRecentOpenedFilesFromLocalStorage,
  writeRecentOpenedFilesToLocalStorage,
  type RecentOpenedFileEntry,
  type RecentOpenedFileKind,
} from './recentOpenedFiles';

export function useRecentOpenedFiles() {
  const [recentOpenedFiles, setRecentOpenedFiles] = useState<RecentOpenedFileEntry[]>([]);

  // Read after mount so the first render matches the server render.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecentOpenedFiles(readRecentOpenedFilesFromLocalStorage());
  }, []);

  const trackRecentOpenedFiles = useCallback((
    files: File[],
    kind: RecentOpenedFileKind,
    options?: { sourcePaths?: Array<string | null | undefined>; fileSizes?: Array<number | undefined> },
  ) => {
    if (files.length === 0) return;

    setRecentOpenedFiles((prev) => {
      const next = [...prev];
      const removedBlobIds: string[] = [];
      const now = Date.now();

      files.forEach((file, index) => {
        const name = file.name?.trim();
        if (!name) return;

        const sourcePath = (typeof options?.sourcePaths?.[index] === 'string' && options.sourcePaths[index]!.trim().length > 0
          ? options.sourcePaths[index]!.trim()
          : undefined);

        // Use the resolved on-disk file size (for path-backed files whose
        // File.size is 0) when available, falling back to the File API size.
        const sizeBytes = options?.fileSizes?.[index] ?? (Number.isFinite(file.size) && file.size > 0 ? file.size : undefined);

        // When a concrete sourcePath is known, use it as the primary dedup key,
        // ignoring sizeBytes. This prevents duplicates when Ctrl+S re-saves the
        // file with an updated thumbnail (changing its size), and ensures mesh
        // files backed by a disk path can be re-opened via the Rust sideload.
        const matchBySourcePath = sourcePath != null;

        const isMatchingEntry = (entry: RecentOpenedFileEntry): boolean => {
          if (entry.kind !== kind || entry.name !== name) return false;
          if (matchBySourcePath) {
            return (entry.sourcePath ?? null) === sourcePath;
          }
          return entry.sizeBytes === sizeBytes
            && (kind !== 'scene' || (entry.sourcePath ?? null) === (sourcePath ?? null));
        };

        const matches = next.filter(isMatchingEntry);

        const existingId = matches.length > 0 ? matches[matches.length - 1].id : uuidv4();
        const duplicateIds = matches.slice(0, -1).map((entry) => entry.id);

        if (matches.length > 0) {
          for (let i = next.length - 1; i >= 0; i -= 1) {
            if (isMatchingEntry(next[i])) {
              next.splice(i, 1);
            }
          }
        }

        if (duplicateIds.length > 0) {
          removedBlobIds.push(...duplicateIds);
        }

        const entry: RecentOpenedFileEntry = {
          id: existingId,
          name,
          kind,
          sourcePath,
          sizeBytes,
          openedAt: now + index,
        };

        next.push(entry);
        void putRecentOpenedFileBlob(entry, file);
      });

      const overflowCount = Math.max(0, next.length - RECENT_OPENED_FILES_LIMIT);
      const overflow = overflowCount > 0
        ? next.slice(0, overflowCount).map((entry) => entry.id)
        : [];
      const trimmed = overflowCount > 0
        ? next.slice(overflowCount)
        : next;

      writeRecentOpenedFilesToLocalStorage(trimmed);

      if (overflow.length > 0 || removedBlobIds.length > 0) {
        void deleteRecentOpenedFileBlobs([...removedBlobIds, ...overflow]);
      }

      return trimmed;
    });
  }, []);

  // Clears the recent-files list: localStorage entries + cached blobs in IndexedDB.
  const clearRecentOpenedFiles = useCallback(() => {
    const ids = recentOpenedFiles.map((entry) => entry.id);
    setRecentOpenedFiles([]);
    writeRecentOpenedFilesToLocalStorage([]);
    if (ids.length > 0) {
      void deleteRecentOpenedFileBlobs(ids);
    }
  }, [recentOpenedFiles]);

  return {
    recentOpenedFiles,
    trackRecentOpenedFiles,
    clearRecentOpenedFiles,
  };
}
