import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const root = path.resolve('src-tauri/frontend-dist');
const report = path.resolve('release-verification/VERIFICACAO' + (process.env.RELEASE_WEBVIEW_CDP ? '-windows-exe' : '-' + process.platform) + '.md');
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };

const fixtures = {
  stl: 'part.stl', obj: 'part.obj', '3mf': 'part.3mf', zip: 'part.zip',
  voxl: 'part.voxl', lys: 'part.lys', chitubox: 'part.chitubox', ctp: 'part.ctp',
  step: 'cube.stp', stp: 'cube.stp',
};

await rm(report, { force: true });
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    const relative = decodeURIComponent(url.pathname).slice(1) || 'index.html';
    const file = path.resolve(root, relative);
    assert(file.startsWith(root + path.sep));
    const bytes = await readFile(file);
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

let browser;
try {
  const channel = process.env.RELEASE_BROWSER_CHANNEL || (process.platform === 'win32' ? 'msedge' : undefined);
  const cdp = process.env.RELEASE_WEBVIEW_CDP;
  browser = cdp
    ? await chromium.connectOverCDP(cdp)
    : await chromium.launch({ channel, args: ['--enable-webgl', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const context = cdp ? browser.contexts()[0] : await browser.newContext({ locale: 'en-US', reducedMotion: 'reduce' });
  const page = cdp ? context.pages().find(p => p.url().includes('tauri.localhost')) : await context.newPage();
  assert(page, 'App window not found');
  await page.addInitScript(() => localStorage.setItem('dragonfruit.locale', 'en'));
  page.setDefaultTimeout(12000);
  page.setDefaultNavigationTimeout(30000);
  page.on('pageerror', error => console.error('[page]', error.message));
  page.on('dialog', async dialog => {
    if (dialog.type() === 'beforeunload') {
      await dialog.accept();
      return;
    }
    console.error('[dialog]', dialog.message());
    await dialog.dismiss();
  });
  const url = cdp ? page.url() : 'http://127.0.0.1:' + server.address().port;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const byButton = name => page.getByRole('button', { name, exact: true });
  const setup = byButton('Get Started');
  const menu = byButton('Open Rambutan Slicer menu');
  // The active printer label is restored from client storage after hydration.
  // The file input itself can already exist in the server-rendered HTML.
  const hydratedPrinter = page.getByRole('button', { name: /^Printer profile .+/ });
  await menu.waitFor({ state: 'attached' });
  if (!cdp || await setup.isVisible()) {
    await setup.click({ timeout: 30000 });
    await byButton('Continue').click();
    await page.getByText('Photon Mono 2', { exact: true }).first().click();
    await byButton('Add printer').click();
    await byButton('Start using Rambutan Slicer').click();
  }

  const inputs = ['#topbar-mesh-input', '#topbar-scene-input'];
  const scenarios = [];
  for (const selector of inputs) {
    const accept = await page.locator(selector).getAttribute('accept');
    const extensions = [...new Set(accept.split(',').map(item => item.trim().toLowerCase())
      .filter(item => item.startsWith('.')).map(item => item.slice(1)))];
    assert(extensions.length, 'No advertised extensions for ' + selector);
    for (const ext of extensions) {
      assert(fixtures[ext], 'Missing release fixture for .' + ext);
      scenarios.push({ selector, ext });
    }
  }
  assert(scenarios.some(item => item.ext === 'step') && scenarios.some(item => item.ext === 'stp'),
    'The STEP extensions must be advertised.');
  const results = [];
  for (const { selector, ext } of scenarios) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await hydratedPrinter.first().waitFor({ timeout: 30000 });
    await page.locator('#scene-root').waitFor({ state: 'attached' });
    const scene = page.locator('#scene-root');
    assert.equal(await scene.getAttribute('data-active-model-id'), null, 'Expected an empty scene');
    console.log('[release] Opening .' + ext + ' via ' + selector);
    const directory = ['step', 'stp'].includes(ext)
      ? 'node_modules/@sunbox/occt-import-js/test/testfiles/simple-basic-cube'
      : 'scripts/release-fixtures';
    const buffer = await readFile(path.join(directory, fixtures[ext]));
    await page.locator(selector).setInputFiles({ name: 'part.' + ext, mimeType: 'application/octet-stream', buffer });
    if (['ctp', 'lys', 'chitubox'].includes(ext)) {
      await page.getByRole('dialog', { name: 'Plugin import experimental warning' })
        .getByRole('button', { name: 'Continue', exact: true }).click();
    }
    const model = page.locator('#scene-root[data-active-model-id]');
    const placement = byButton('Load As-Is');
    await model.or(placement).first().waitFor({ state: 'attached', timeout: 45000 });
    if (await placement.isVisible()) {
      await placement.click();
      await model.waitFor({ state: 'attached', timeout: 45000 });
    }
    const triangles = Number(await model.getAttribute('data-active-model-triangles'));
    assert(triangles > 0, '.' + ext + ' imported without geometry');
    results.push({ ext, kind: selector.includes('mesh') ? 'Malha' : 'Cena', triangles });
    console.log('[release] OK .' + ext + ' (' + triangles + ' triangles)');
  }

  await page.reload({ waitUntil: 'domcontentloaded' });
  await hydratedPrinter.first().waitFor({ timeout: 30000 });
  await page.locator('#scene-root').waitFor({ state: 'attached' });
  await page.locator(inputs[0]).setInputFiles({
    name: 'invalid.step', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid STEP'),
  });
  await menu.click();
  await page.getByText('Import diagnostics', { exact: true }).click();
  const json = page.getByRole('textbox', { name: 'Import diagnostics' });
  await json.waitFor({ timeout: 30000 });
  const [failure] = JSON.parse(await json.inputValue());
  assert.equal(failure.version, version);
  assert.equal(failure.file, 'invalid.step');
  assert(failure.stage && failure.details);
  console.log('[release] Invalid STEP diagnostics OK');

  await mkdir(path.dirname(report), { recursive: true });
  const notes = await readFile('docs/release/NOTAS.md', 'utf8');
  await writeFile(report, [
    '# Verificação de importação do Rambutan Slicer ' + version, '',
    (failure.revision ? 'Revisão ' + failure.revision + ' · ' : '') + new Date().toISOString(), '',
    cdp ? 'Validação na janela do executável Windows.' : 'Validação na interface do frontend de produção preparado para o Tauri.', '',
    '| Extensão | Entrada | Triângulos carregados |', '| --- | --- | ---: |',
    ...results.map(({ ext, kind, triangles }) => '| .' + ext + ' | ' + kind + ' | ' + triangles + ' |'),
    '', 'Um STEP inválido registrou a versão, o arquivo, a etapa e os detalhes técnicos.', '',
    notes.trim(), '',
  ].join('\n'));
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

