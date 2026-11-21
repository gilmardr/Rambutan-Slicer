#!/usr/bin/env node
/**
 * Generates generic, brand-neutral printer silhouettes (SVG) for the Creality
 * profile plugin. No manufacturer photos, logos or trade dress are used: each
 * drawing is the same simple resin-printer shape (base + UV lid + Z rail),
 * scaled to the printer's approximate external dimensions and coloured with
 * the Rambutan palette (docs/brand/README.md).
 *
 * Usage: node scripts/generate-printer-illustrations.mjs
 * Output: plugins/creality/illustrations/<slug>.svg
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'plugins', 'creality', 'illustrations');

// Approximate external dimensions in mm (width × depth × height), rounded.
// baseRatio: fraction of the height taken by the base below the lid.
// screen: front touchscreen width as a fraction of the front face (0 = none).
const PRINTERS = [
  { slug: 'ld-002r', w: 220, d: 220, h: 400, baseRatio: 0.36, screen: 0.34 },
  { slug: 'ld-002h', w: 225, d: 225, h: 405, baseRatio: 0.36, screen: 0.34 },
  { slug: 'ld-006', w: 330, d: 300, h: 505, baseRatio: 0.34, screen: 0.3 },
  { slug: 'halot-one', w: 220, d: 220, h: 405, baseRatio: 0.38, screen: 0.32 },
  { slug: 'halot-one-pro', w: 250, d: 250, h: 475, baseRatio: 0.38, screen: 0.32 },
  { slug: 'halot-one-plus', w: 260, d: 260, h: 500, baseRatio: 0.38, screen: 0.32 },
  { slug: 'halot-r6', w: 230, d: 230, h: 420, baseRatio: 0.38, screen: 0.32 },
  { slug: 'halot-lite', w: 330, d: 300, h: 560, baseRatio: 0.36, screen: 0.3 },
  { slug: 'halot-play', w: 330, d: 300, h: 540, baseRatio: 0.36, screen: 0.3 },
  { slug: 'halot-ray', w: 335, d: 330, h: 540, baseRatio: 0.36, screen: 0.3 },
  { slug: 'halot-sky-2025', w: 350, d: 320, h: 580, baseRatio: 0.35, screen: 0.3 },
  { slug: 'halot-mage', w: 340, d: 330, h: 560, baseRatio: 0.33, screen: 0.28 },
  { slug: 'halot-mage-pro', w: 340, d: 330, h: 560, baseRatio: 0.33, screen: 0.28 },
  { slug: 'halot-mage-s', w: 340, d: 330, h: 560, baseRatio: 0.33, screen: 0.28 },
  { slug: 'halot-x1-neo', w: 245, d: 240, h: 440, baseRatio: 0.4, screen: 0.32 },
  { slug: 'halot-x1', w: 360, d: 330, h: 590, baseRatio: 0.4, screen: 0.28 },
  { slug: 'halot-x1-max', w: 470, d: 420, h: 700, baseRatio: 0.4, screen: 0.26 },
];

// Rambutan palette, tuned to read on both the dark card (#2b3039) and light UI.
const C = {
  baseFront: '#1D9E75',
  baseSide: '#137A5A',
  baseTop: '#3DB58D',
  outline: '#0B4F3D',
  screen: '#04342C',
  screenGlow: '#EF9F27',
  vat: '#0B4F3D',
  rail: '#9FB3AD',
  plate: '#C9D6D2',
  lid: '#D4537E',
  lidEdge: '#ED93B1',
  lidTop: '#E27A9D',
};

const MAX_H = Math.max(...PRINTERS.map((p) => p.h));
const VIEW = 400; // square viewBox
const PAD = 24;
const OBLIQUE = 0.45; // depth foreshortening
const ANGLE = Math.PI / 6; // 30°

const f = (n) => Number(n.toFixed(1));
const poly = (pts, attrs) =>
  `<polygon points="${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(' ')}" ${attrs}/>`;

/** Axis-aligned box in cabinet projection. Returns front/side/top polygons. */
function box(x, y, w, h, d, s) {
  const dx = d * OBLIQUE * Math.cos(ANGLE) * s;
  const dy = d * OBLIQUE * Math.sin(ANGLE) * s;
  const X = x;
  const Y = y;
  const W = w * s;
  const H = h * s;
  return {
    front: [[X, Y], [X + W, Y], [X + W, Y + H], [X, Y + H]],
    side: [[X + W, Y], [X + W + dx, Y - dy], [X + W + dx, Y - dy + H], [X + W, Y + H]],
    top: [[X, Y], [X + dx, Y - dy], [X + W + dx, Y - dy], [X + W, Y]],
    dx,
    dy,
  };
}

function render(p) {
  const extentW = p.w + p.d * OBLIQUE * Math.cos(ANGLE);
  const extentH = p.h + p.d * OBLIQUE * Math.sin(ANGLE);
  // Fit to the box, then shrink smaller printers a little so relative size
  // still reads across the library (the tallest model fills the box).
  const fit = Math.min((VIEW - 2 * PAD) / extentW, (VIEW - 2 * PAD) / extentH);
  const s = fit * (0.72 + 0.28 * (p.h / MAX_H));
  const ox = (VIEW - extentW * s) / 2;
  // Bottom-align so every printer stands on the same floor line.
  const oy = VIEW - PAD - p.h * s;

  const baseH = p.h * p.baseRatio;
  const lidH = p.h - baseH;
  const inset = Math.min(p.w, p.d) * 0.04;

  const baseY = oy + lidH * s;
  const base = box(ox, baseY, p.w, baseH, p.d, s);

  const lidX = ox + inset * s;
  const lidW = p.w - 2 * inset;
  const lidD = p.d - 2 * inset;
  // shift lid back by `inset` in depth so it sits centred on the base top
  const backShiftX = inset * OBLIQUE * Math.cos(ANGLE) * s;
  const backShiftY = inset * OBLIQUE * Math.sin(ANGLE) * s;
  const lid = box(lidX + backShiftX, oy - backShiftY, lidW, lidH, lidD, s);

  // Internals, positioned at mid depth so they read "inside" the lid.
  const midX = d => ox + p.w * 0.5 * s + d * OBLIQUE * Math.cos(ANGLE) * s;
  const midY = d => d * OBLIQUE * Math.sin(ANGLE) * s;
  const railW = p.w * 0.07;
  const railX = midX(p.d * 0.8) - (railW * s) / 2;
  const railTop = oy + lidH * 0.08 * s - midY(p.d * 0.8);
  const railBottom = baseY - midY(p.d * 0.8);
  const plateW = p.w * 0.46;
  const plateH = lidH * 0.07;
  const plateY = oy + lidH * 0.38 * s - midY(p.d * 0.45);
  const plate = box(midX(p.d * 0.25) - (plateW * s) / 2, plateY, plateW, plateH, p.d * 0.45, s);
  const armY = plateY - midY(0) + plateH * 0.2 * s;
  const vatW = p.w * 0.62;
  const vatH = baseH * 0.07;
  const vat = box(midX(p.d * 0.2) - (vatW * s) / 2, baseY - midY(p.d * 0.2) - vatH * s, vatW, vatH, p.d * 0.55, s);

  // Front touchscreen on the base.
  const scrW = p.w * p.screen * s;
  const scrH = baseH * 0.34 * s;
  const scrX = ox + (p.w * s - scrW) / 2;
  const scrY = baseY + baseH * 0.28 * s;

  const stroke = `stroke="${C.outline}" stroke-width="2" stroke-linejoin="round"`;
  const lidStroke = `stroke="${C.lidEdge}" stroke-width="2" stroke-linejoin="round"`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}" role="img" aria-label="Generic resin printer illustration">
  <!-- Generic illustration, not a product photo. Proportions approximate
       ${p.w} × ${p.d} × ${p.h} mm (W × D × H). Rambutan Slicer, AGPL-3.0-or-later. -->
  <ellipse cx="${f(ox + (extentW * s) / 2)}" cy="${f(baseY + baseH * s + 6)}" rx="${f((extentW * s) / 2)}" ry="8" fill="#000" opacity="0.18"/>
  ${poly(base.side, `fill="${C.baseSide}" ${stroke}`)}
  ${poly(base.top, `fill="${C.baseTop}" ${stroke}`)}
  ${poly(base.front, `fill="${C.baseFront}" ${stroke}`)}
  <rect x="${f(scrX)}" y="${f(scrY)}" width="${f(scrW)}" height="${f(scrH)}" rx="4" fill="${C.screen}"/>
  <rect x="${f(scrX + scrW * 0.12)}" y="${f(scrY + scrH * 0.4)}" width="${f(scrW * 0.3)}" height="${f(scrH * 0.2)}" rx="2" fill="${C.screenGlow}"/>
  ${poly(vat.side, `fill="${C.vat}"`)}
  ${poly(vat.top, `fill="${C.outline}"`)}
  ${poly(vat.front, `fill="${C.vat}"`)}
  <rect x="${f(railX)}" y="${f(railTop)}" width="${f(railW * s)}" height="${f(railBottom - railTop)}" fill="${C.rail}"/>
  <rect x="${f(Math.min(railX, midX(p.d * 0.25)))}" y="${f(armY)}" width="${f(Math.abs(midX(p.d * 0.25) - railX) + railW * s)}" height="${f(plateH * 0.6 * s)}" fill="${C.rail}"/>
  ${poly(plate.side, `fill="${C.rail}"`)}
  ${poly(plate.top, `fill="${C.plate}"`)}
  ${poly(plate.front, `fill="${C.plate}"`)}
  ${poly(lid.side, `fill="${C.lid}" fill-opacity="0.38" ${lidStroke}`)}
  ${poly(lid.top, `fill="${C.lidTop}" fill-opacity="0.55" ${lidStroke}`)}
  ${poly(lid.front, `fill="${C.lid}" fill-opacity="0.32" ${lidStroke}`)}
</svg>
`;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const p of PRINTERS) {
  writeFileSync(join(OUT_DIR, `${p.slug}.svg`), render(p));
}
console.log(`Wrote ${PRINTERS.length} illustrations to ${OUT_DIR}`);
