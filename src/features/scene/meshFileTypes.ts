export const MESH_FILE_EXTENSIONS = ['.stl', '.obj', '.3mf', '.step', '.stp'] as const;
export type MeshFileExtension = (typeof MESH_FILE_EXTENSIONS)[number];

export const MESH_FILE_EXTENSION_SET: ReadonlySet<string> = new Set(MESH_FILE_EXTENSIONS);
export const MESH_FILE_ACCEPT = [...MESH_FILE_EXTENSIONS, '.zip'].join(',');
export const MESH_FILE_FORMAT_LABELS = MESH_FILE_EXTENSIONS.map((extension) =>
  extension.slice(1).toUpperCase(),
);

export function getMeshFileExtension(name: string): MeshFileExtension | null {
  const normalized = name.trim().toLowerCase();
  return MESH_FILE_EXTENSIONS.find((extension) => normalized.endsWith(extension)) ?? null;
}
