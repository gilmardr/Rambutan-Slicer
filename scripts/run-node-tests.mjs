import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const suite = process.argv[2];
const watch = process.argv.includes('--watch');

if (suite !== 'unit' && suite !== 'dom') {
  throw new Error('Choose the unit or dom test suite.');
}

const roots = suite === 'dom' ? ['src'] : ['src', 'plugins'];
const testFilePattern = suite === 'dom' ? /\.dom-test\.tsx$/ : /\.test\.(?:ts|tsx)$/;
const ignoredDirectories = new Set(['.git', '.next', 'dist', 'frontend-dist', 'node_modules', 'target']);

async function collectTestFiles(root, files = []) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) await collectTestFiles(fullPath, files);
    } else if (entry.isFile() && testFilePattern.test(entry.name)) {
      files.push(path.relative(projectRoot, fullPath));
    }
  }
  return files;
}

const files = (await Promise.all(roots.map((root) => collectTestFiles(path.join(projectRoot, root)))))
  .flat()
  .sort();

if (files.length === 0) {
  throw new Error(`No ${suite} test files were found.`);
}

const batches = watch || suite === 'dom'
  ? [files]
  : Array.from({ length: Math.ceil(files.length / 64) }, (_, index) => files.slice(index * 64, (index + 1) * 64));
const register = suite === 'dom' ? './scripts/test-dom/register.mjs' : './scripts/test-unit/register.mjs';

for (const batch of batches) {
  const args = ['--import', 'tsx', '--import', register];
  if (suite === 'dom') args.push('--test-concurrency=1');
  args.push('--test');
  if (watch) args.push('--watch');
  args.push(...batch);

  const exitCode = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: projectRoot, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });

  if (exitCode !== 0) {
    process.exitCode = exitCode;
    break;
  }
}
