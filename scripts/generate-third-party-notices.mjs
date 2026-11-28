// Writes public/THIRD-PARTY-NOTICES.txt: the copyright notices and license texts
// of the npm packages and Rust crates that are built into the app.
//
// MIT, BSD, ISC and Apache-2.0 ask for their notice to travel with compiled
// copies too, not only with the source. The file is copied into the Tauri
// frontend with the rest of public/, so every installer carries it.
//
// npm: production packages from package-lock.json that are installed in
// node_modules (dev-only packages never reach the bundle).
// Rust: every crates.io or git dependency in the resolved graph of
// src-tauri/Cargo.toml, as reported by `cargo metadata`. Without cargo the Rust
// section is skipped with a warning, unless --strict is passed.
//
// Usage: node scripts/generate-third-party-notices.mjs [--strict] [--out <file>]

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);
const strict = args.includes('--strict');
const outIndex = args.indexOf('--out');
const outFile = path.resolve(root, outIndex >= 0 ? args[outIndex + 1] : 'public/THIRD-PARTY-NOTICES.txt');

const LICENSE_FILE = /^(?:LICEN[CS]E|COPYING|NOTICE|COPYRIGHT|UNLICENSE)(?:[-._].*)?$/i;
const SEPARATOR = '='.repeat(78);

function licenseFilesIn(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => LICENSE_FILE.test(name))
    .map((name) => path.join(directory, name))
    .filter((file) => statSync(file).isFile())
    .sort();
}

function licenseExpression(value) {
  if (!value) return 'UNKNOWN';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(licenseExpression).join(' OR ');
  return value.type ?? 'UNKNOWN';
}

function renderEntry({ name, version, license, source, files }) {
  const lines = [SEPARATOR, `${name} ${version}`, `License: ${license}`];
  if (source) lines.push(`Source: ${source}`);
  lines.push('');
  if (files.length === 0) {
    lines.push(`(No license file ships with this package; its declared license is ${license}.)`, '');
  }
  for (const file of files) {
    lines.push(`--- ${path.basename(file)} ---`, readFileSync(file, 'utf8').trimEnd(), '');
  }
  return lines.join('\n');
}

function npmEntries() {
  const lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
  const entries = [];
  const seen = new Set();
  for (const [key, meta] of Object.entries(lock.packages ?? {})) {
    if (!key || meta.dev || meta.link) continue;
    const directory = path.join(root, key);
    const manifestPath = path.join(directory, 'package.json');
    if (!existsSync(manifestPath)) continue; // optional platform binary not installed here
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const name = manifest.name ?? key.replace(/^.*node_modules\//, '');
    const id = `${name}@${manifest.version}`;
    if (seen.has(id)) continue;
    seen.add(id);
    entries.push({
      name,
      version: manifest.version ?? '',
      license: licenseExpression(manifest.license ?? manifest.licenses ?? meta.license),
      source: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url,
      files: licenseFilesIn(directory),
    });
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

function rustEntries() {
  let metadata;
  try {
    const target = process.env.RAMBUTAN_NOTICES_TARGET;
    const targetArgs = target ? ['--filter-platform', target] : [];
    const output = execFileSync(
      'cargo',
      ['metadata', '--format-version', '1', '--locked', ...targetArgs, '--manifest-path', path.join(root, 'src-tauri', 'Cargo.toml')],
      { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] },
    );
    metadata = JSON.parse(output);
  } catch (error) {
    const message = `[third-party-notices] cargo metadata failed (${error.message.split('\n')[0]}); Rust crates are missing from the notices.`;
    if (strict) throw new Error(message);
    console.warn(message);
    return [];
  }
  const resolved = new Set((metadata.resolve?.nodes ?? []).map((node) => node.id));
  return metadata.packages
    .filter((pkg) => pkg.source && resolved.has(pkg.id))
    .map((pkg) => {
      const directory = path.dirname(pkg.manifest_path);
      const files = licenseFilesIn(directory);
      if (pkg.license_file) {
        const declared = path.resolve(directory, pkg.license_file);
        if (existsSync(declared) && !files.includes(declared)) files.push(declared);
      }
      return {
        name: pkg.name,
        version: pkg.version,
        license: pkg.license ?? (pkg.license_file ? `see ${pkg.license_file}` : 'UNKNOWN'),
        source: pkg.repository ?? undefined,
        files,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const npm = npmEntries();
const rust = rustEntries();

const header = [
  'Rambutan Slicer: third-party notices',
  '',
  'Rambutan Slicer is licensed under the GNU Affero General Public License,',
  'version 3 or later. Its source code is at https://github.com/gilmardr/Rambutan-Slicer.',
  'It is a modified version of DragonFruit by the Open Resin Alliance',
  '(https://github.com/Open-Resin-Alliance/DragonFruit).',
  '',
  'The app also contains the following third-party software, each under its own',
  'license. Printer plugins carry their own LICENSE files next to them, and the',
  'STEP importer (OCCT, LGPL-2.1) carries its notices in vendor/occt-import-js/.',
  '',
  `npm packages: ${npm.length}`,
  `Rust crates: ${rust.length}`,
  '',
].join('\n');

const body = [
  header,
  SEPARATOR,
  'NPM PACKAGES',
  ...npm.map(renderEntry),
  SEPARATOR,
  'RUST CRATES',
  ...rust.map(renderEntry),
].join('\n');

mkdirSync(path.dirname(outFile), { recursive: true });
writeFileSync(outFile, `${body}\n`);
console.log(
  `[third-party-notices] Wrote ${path.relative(root, outFile)}: ${npm.length} npm packages, ${rust.length} Rust crates.`,
);
