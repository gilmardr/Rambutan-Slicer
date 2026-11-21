export type PreparedModelLibraryEntry = {
  name: string;
  kind: 'mesh' | 'scene';
  storedName: string;
  sizeBytes: number;
  path: string;
  updatedAt: string;
  backupCount: number;
};
