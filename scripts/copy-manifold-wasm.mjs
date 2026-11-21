import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const targetDirectory = path.join(root, 'public', 'vendor');
await mkdir(targetDirectory, { recursive: true });
await copyFile(
  path.join(root, 'node_modules', 'manifold-3d', 'manifold.wasm'),
  path.join(targetDirectory, 'manifold.wasm'),
);
