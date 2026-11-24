import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const packageRoot = path.join(root, 'node_modules', '@sunbox', 'occt-import-js');
const targetDirectory = path.join(root, 'public', 'vendor', 'occt-import-js');
const assets = [
  ['dist/occt-import-js-worker.js', 'occt-import-js-worker.js'],
  ['dist/occt-import-js.js', 'occt-import-js.js'],
  ['dist/occt-import-js.wasm', 'occt-import-js.wasm'],
  ['dist/license.occt-import-js.txt', 'license.occt-import-js.txt'],
  ['dist/license.occt.txt', 'license.occt.txt'],
  ['dist/OCCT_LGPL_EXCEPTION.txt', 'OCCT_LGPL_EXCEPTION.txt'],
  ['LICENSE.md', 'LICENSE.md'],
];

await mkdir(targetDirectory, { recursive: true });
for (const [source, destination] of assets) {
  await copyFile(
    path.join(packageRoot, source),
    path.join(targetDirectory, destination),
  );
}

console.log('[copy-occt-import-assets] Copied the STEP importer and license notices to public/vendor/occt-import-js.');
