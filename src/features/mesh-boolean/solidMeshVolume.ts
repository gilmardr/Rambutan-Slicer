import type { SolidMesh } from './solidMeshOperations';

export function solidMeshVolume(mesh: SolidMesh): number {
  const indices = mesh.indices ?? Uint32Array.from({ length: mesh.positions.length / 3 }, (_, index) => index);
  let volume = 0;
  for (let index = 0; index < indices.length; index += 3) {
    const a = indices[index] * 3;
    const b = indices[index + 1] * 3;
    const c = indices[index + 2] * 3;
    volume += mesh.positions[a] * (mesh.positions[b + 1] * mesh.positions[c + 2] - mesh.positions[b + 2] * mesh.positions[c + 1])
      + mesh.positions[a + 1] * (mesh.positions[b + 2] * mesh.positions[c] - mesh.positions[b] * mesh.positions[c + 2])
      + mesh.positions[a + 2] * (mesh.positions[b] * mesh.positions[c + 1] - mesh.positions[b + 1] * mesh.positions[c]);
  }
  return Math.abs(volume / 6);
}
