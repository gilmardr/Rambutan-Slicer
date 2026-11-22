import { execFileSync } from 'node:child_process';
import { access, copyFile, cp, lstat, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const nextRoot = path.resolve(projectRoot, '.next');
const frontendDistRoot = path.resolve(projectRoot, 'src-tauri', 'frontend-dist');
const srcIndex = path.resolve(nextRoot, 'server', 'app', 'index.html');
const dstIndex = path.resolve(frontendDistRoot, 'index.html');
const srcNextStatic = path.resolve(nextRoot, 'static');
const dstNextStatic = path.resolve(frontendDistRoot, '_next', 'static');
const srcPublic = path.resolve(projectRoot, 'public');
const srcPlugins = path.resolve(projectRoot, 'plugins');
const dstPlugins = path.resolve(frontendDistRoot, 'plugins');
const nextDev = path.resolve(nextRoot, 'dev');

function skipNodeModules(sourcePath) {
      return path.basename(sourcePath) !== 'node_modules';
}

// The webview only reads plugin manifests, README files and images at runtime.
// Source code, git metadata, test corpora and files git ignores (such as the
// unlicensed photos kept out of the repository) must not ship in the app.
const PLUGIN_RUNTIME_FILE = /\.(?:json|md|png|jpe?g|webp|gif|avif|svg)$/i;
const PLUGIN_LICENSE_FILE = /^(?:LICEN[CS]E|NOTICE|COPYING)(?:[-.][^/]*)?$/i;

function isPluginRuntimeFile(relativePath) {
      const base = path.posix.basename(relativePath);
      return PLUGIN_RUNTIME_FILE.test(base) || PLUGIN_LICENSE_FILE.test(base);
}

/** Tracked plugin files (submodules included), relative to plugins/, or null without git. */
function listTrackedPluginFiles() {
      try {
            const output = execFileSync('git', ['ls-files', '-z', '--recurse-submodules', '--', 'plugins'], {
                  cwd: projectRoot,
                  encoding: 'utf8',
                  maxBuffer: 64 * 1024 * 1024,
            });
            return output.split('\0').filter(Boolean).map((file) => file.replace(/^plugins\//, ''));
      } catch {
            return null;
      }
}

async function copyPluginRuntimeFiles() {
      const tracked = listTrackedPluginFiles();
      if (!tracked) {
            console.warn('[prepare-tauri-frontend] git is unavailable; copying plugin runtime files by extension only.');
            await cp(srcPlugins, dstPlugins, {
                  recursive: true,
                  force: true,
                  filter: async (sourcePath) => {
                        const base = path.basename(sourcePath);
                        if (base === 'node_modules' || base === '.git' || base === 'target') return false;
                        if ((await lstat(sourcePath)).isDirectory()) return true;
                        return isPluginRuntimeFile(base);
                  },
            });
            return null;
      }

      let copied = 0;
      for (const relative of tracked) {
            if (!isPluginRuntimeFile(relative)) continue;
            const source = path.resolve(srcPlugins, relative);
            if (!(await ensureFileExists(source))) continue;
            const destination = path.resolve(dstPlugins, relative);
            await mkdir(path.dirname(destination), { recursive: true });
            await copyFile(source, destination);
            copied += 1;
      }
      return copied;
}

async function ensureFileExists(filePath) {
      try {
            await access(filePath);
            return true;
      } catch {
            return false;
      }
}

async function main() {
      const hasSrc = await ensureFileExists(srcIndex);
      if (!hasSrc) {
            throw new Error(`[prepare-tauri-frontend] Missing source index: ${srcIndex}`);
      }

      await rm(frontendDistRoot, { recursive: true, force: true });
      await mkdir(frontendDistRoot, { recursive: true });
      await copyFile(srcIndex, dstIndex);

      const hasNextStatic = await ensureFileExists(srcNextStatic);
      if (!hasNextStatic) {
            throw new Error(`[prepare-tauri-frontend] Missing Next static directory: ${srcNextStatic}`);
      }

      await mkdir(path.dirname(dstNextStatic), { recursive: true });
      await cp(srcNextStatic, dstNextStatic, { recursive: true, force: true, filter: skipNodeModules });

      const hasPublic = await ensureFileExists(srcPublic);
      if (hasPublic) {
            await cp(srcPublic, frontendDistRoot, { recursive: true, force: true, filter: skipNodeModules });
      }

      const hasPlugins = await ensureFileExists(srcPlugins);
      let pluginFileCount = null;
      if (hasPlugins) {
            pluginFileCount = await copyPluginRuntimeFiles();
      }

      // Tauri embeds everything under frontendDist. Next dev artifacts can include
      // transient turbopack files that disappear between builds and break asset embedding.
      //
      // `.next/cache` stays: frontendDist is the curated copy above, so nothing in it is
      // embedded, and it is Turbopack's persistent build cache, which CI restores between
      // runs. Deleting it here left `actions/cache` with nothing to save. Locally, a build
      // over the cache of the previous commit took 15.8 s against 25-29 s cold.
      await rm(nextDev, { recursive: true, force: true });

      console.log(`[prepare-tauri-frontend] Prepared ${path.relative(projectRoot, dstIndex)} from ${path.relative(projectRoot, srcIndex)}`);
      console.log(`[prepare-tauri-frontend] Mirrored ${path.relative(projectRoot, srcNextStatic)} -> ${path.relative(projectRoot, dstNextStatic)}`);
      if (hasPublic) {
            console.log(`[prepare-tauri-frontend] Copied public assets from ${path.relative(projectRoot, srcPublic)} to ${path.relative(projectRoot, frontendDistRoot)}`);
      }
      if (hasPlugins) {
            const countLabel = pluginFileCount === null ? '' : ` (${pluginFileCount} runtime files)`;
            console.log(`[prepare-tauri-frontend] Copied plugin assets${countLabel} from ${path.relative(projectRoot, srcPlugins)} to ${path.relative(projectRoot, dstPlugins)}`);
      }
      console.log(`[prepare-tauri-frontend] Removed transient dev artifacts from ${path.relative(projectRoot, nextRoot)} and prepared ${path.relative(projectRoot, frontendDistRoot)}`);
}

main().catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
});
