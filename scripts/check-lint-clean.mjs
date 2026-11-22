/**
 * Runs ESLint over the directories that are already clean, and fails on any
 * problem found there.
 *
 * The repo carries thousands of pre-existing ESLint problems, so `npm run lint`
 * cannot gate CI as a whole — a full-repo gate would either be permanently red
 * or force one enormous, unreviewable cleanup. This check inverts the ratchet:
 * a directory is cleaned once, listed in scripts/lint-clean-dirs.json, and from
 * then on CI refuses any new error or warning inside it. Coverage grows one
 * directory at a time and never slides back.
 *
 * Warnings count as failures. A directory only earns its place on the list when
 * `npx eslint <dir> --max-warnings 0` already passes, so tolerating warnings
 * afterwards would just let the debt back in through the side door.
 *
 * A few correctness rules (`repoWideRules` in the same file) are already at
 * zero across all of src, so they are checked everywhere rather than per
 * directory: a conditional hook in a file no listed directory reaches still
 * fails the build.
 *
 * Usage:
 *   node scripts/check-lint-clean.mjs            # check every listed directory and the repo-wide rules
 *   node scripts/check-lint-clean.mjs <dir>…     # check specific directories only
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const projectRoot = process.cwd();
const LIST_FILE = 'scripts/lint-clean-dirs.json';
const ESLINT_CLI = path.join(projectRoot, 'node_modules', 'eslint', 'bin', 'eslint.js');

const REPO_WIDE_ROOTS = ['src'];

async function readList() {
      const raw = await fs.readFile(path.join(projectRoot, LIST_FILE), 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed.directories)) {
            throw new Error(`${LIST_FILE} has no "directories" array.`);
      }
      const repoWideRules = Array.isArray(parsed.repoWideRules) ? parsed.repoWideRules : [];
      return { directories: parsed.directories, repoWideRules };
}

/** Lints the repo-wide roots running only the given rules; returns the problems found. */
async function runRepoWideRules(rules) {
      const { ESLint } = await import(pathToFileURL(path.join(projectRoot, 'node_modules', 'eslint', 'lib', 'api.js')).href);
      const ruleSet = new Set(rules);
      const eslint = new ESLint({ cwd: projectRoot, ruleFilter: ({ ruleId }) => ruleSet.has(ruleId) });
      const results = await eslint.lintFiles(REPO_WIDE_ROOTS);
      const problems = [];
      for (const result of results) {
            for (const message of result.messages) {
                  // A fatal parse error has no ruleId and would hide every rule in that file.
                  if (message.ruleId && !ruleSet.has(message.ruleId)) continue;
                  problems.push({ file: path.relative(projectRoot, result.filePath), ...message });
            }
      }
      return problems;
}

/** A renamed or deleted directory must fail loudly — silently losing coverage is the failure mode this check exists to prevent. */
async function checkDirectoriesExist(directories) {
      const missing = [];
      for (const directory of directories) {
            try {
                  const stats = await fs.stat(path.join(projectRoot, directory));
                  if (!stats.isDirectory()) missing.push(directory);
            } catch {
                  missing.push(directory);
            }
      }
      return missing;
}

/** A listed directory covers a submodule when either path contains the other. */
function covers(directory, submodulePath) {
      const dir = directory.replace(/\/+$/, '');
      if (dir === '' || dir === '.') return true;
      return (
            submodulePath === dir ||
            submodulePath.startsWith(`${dir}/`) ||
            dir.startsWith(`${submodulePath}/`)
      );
}

/**
 * An uninitialized submodule is an empty directory, so it survives the existence
 * check above and then ESLint refuses the whole run with "all of the files
 * matching the glob pattern are ignored" — a message that says nothing about the
 * cause. Worse, once a listed entry sits *above* the submodules (`plugins` rather
 * than `plugins/ctb`), the directory is no longer empty and the run goes green
 * having linted a fraction of what it claims to cover.
 *
 * So read the submodule paths from .gitmodules rather than inferring them from
 * the list, and check the ones any listed directory reaches.
 */
async function uninitializedSubmodules(directories) {
      let raw;
      try {
            raw = await fs.readFile(path.join(projectRoot, '.gitmodules'), 'utf8');
      } catch {
            return [];
      }
      const submodulePaths = [...raw.matchAll(/^\s*path\s*=\s*(.+)$/gm)].map((match) => match[1].trim());
      const uninitialized = [];
      for (const submodulePath of submodulePaths) {
            if (!directories.some((directory) => covers(directory, submodulePath))) continue;
            try {
                  const contents = await fs.readdir(path.join(projectRoot, submodulePath));
                  if (contents.length === 0) uninitialized.push(submodulePath);
            } catch {
                  // Not on disk at all — checkDirectoriesExist already reports it if it was listed.
            }
      }
      return uninitialized;
}

function runEslint(directories) {
      return new Promise((resolve, reject) => {
            const child = spawn(
                  process.execPath,
                  [ESLINT_CLI, '--max-warnings', '0', ...directories],
                  { cwd: projectRoot, stdio: 'inherit' },
            );
            child.on('error', reject);
            child.on('close', (code) => resolve(code ?? 1));
      });
}

async function main() {
      const requested = process.argv.slice(2);
      const list = await readList();
      const directories = requested.length > 0 ? requested : list.directories;
      const repoWideRules = requested.length > 0 ? [] : list.repoWideRules;

      if (directories.length === 0) {
            console.log('[lint-clean] No directories under lint control yet.');
            return;
      }

      const missing = await checkDirectoriesExist(directories);
      if (missing.length > 0) {
            console.error('[lint-clean] Listed directories that no longer exist:');
            for (const directory of missing) console.error(`  - ${directory}`);
            console.error(`Update ${LIST_FILE} to follow the rename — do not just drop the entry.`);
            process.exit(1);
      }

      const uninitialized = await uninitializedSubmodules(directories);
      if (uninitialized.length > 0) {
            console.error('[lint-clean] Submodules under lint control are not checked out:');
            for (const submodulePath of uninitialized) console.error(`  - ${submodulePath}`);
            console.error('Run `git submodule update --init --recursive` and try again.');
            process.exit(1);
      }

      const code = await runEslint(directories);
      if (code !== 0) {
            console.error('');
            console.error(`[lint-clean] ESLint reported problems in directories that are supposed to be clean.`);
            console.error(`Fix them — removing the directory from ${LIST_FILE} is not the fix.`);
            process.exit(1);
      }

      if (repoWideRules.length > 0) {
            const problems = await runRepoWideRules(repoWideRules);
            if (problems.length > 0) {
                  for (const problem of problems) {
                        console.error(`${problem.file}:${problem.line}:${problem.column}  ${problem.ruleId ?? 'fatal'}  ${problem.message}`);
                  }
                  console.error('');
                  console.error(`[lint-clean] ${problems.length} problem(s) from rules that must stay at zero across ${REPO_WIDE_ROOTS.join(', ')}.`);
                  process.exit(1);
            }
      }

      console.log(`[lint-clean] OK: ${directories.length} directories clean (0 errors, 0 warnings)${repoWideRules.length > 0 ? `, ${repoWideRules.length} rules clean across ${REPO_WIDE_ROOTS.join(', ')}` : ''}.`);
}

main().catch((error) => {
      console.error('[lint-clean] Failed to run check:', error);
      process.exit(1);
});
