// Capturas de la mesa con el celular en vertical (modo demo de vite: ?demo=game y ?demo=game6).
//
//   node e2e/portrait-shots.mjs     (vite en :5173 y el servidor en :3001)
//
// Deja e2e/shots/portrait-*.png en 390×844 (iPhone) y 360×740 (Android chico).
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_URL || 'http://localhost:5173';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch();
const problems = [];
for (const [w, h] of [[390, 844], [360, 740]]) {
  for (const demo of ['game', 'game6']) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => problems.push(`${demo} ${w}: ${e.message}`));
    await page.goto(`${BASE}/?demo=${demo}`);
    await page.locator('.gt-root:not(.gt-loading)').waitFor({ timeout: 15000 });
    await sleep(3500);
    await page.screenshot({ path: `${SHOTS}portrait-${demo}-${w}.png` });
    console.log('captura', `portrait-${demo}-${w}.png`);
    await ctx.close();
  }
}
await browser.close();
if (problems.length) { console.log(problems.join('\n')); process.exitCode = 1; }
