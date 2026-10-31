// Partida real en un celular en vertical (390×844, táctil) contra 3 bots: portada, sala, mesa,
// carta elegida con sus destinos, ayuda con presión larga, emotes, chat y el fin.
//
//   node e2e/portrait-play.mjs     (servidor en :3001 y vite en :5173)
//
// Deja e2e/shots/pplay-*.png.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chooseBotAction } from '../shared/engine/index.js';

const BASE = process.env.E2E_URL || 'http://localhost:5173';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const problems = [];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
const shot = async (name) => { await page.screenshot({ path: `${SHOTS}pplay-${name}.png` }); console.log('captura', name); };
const store = (fn, arg) => page.evaluate(fn, arg);

// Presión larga con eventos de puntero táctiles (Playwright no tiene long-press)
const longPress = async (loc, ms = 700) => {
  const b = await loc.boundingBox();
  const x = b.x + b.width / 2;
  const y = b.y + b.height * 0.3;
  const init = { pointerType: 'touch', isPrimary: true, bubbles: true, clientX: x, clientY: y, pointerId: 7 };
  await loc.dispatchEvent('pointerdown', init);
  await sleep(ms);
  await shot('tip-longpress');
  await loc.dispatchEvent('pointerup', init);
  await loc.dispatchEvent('click', { bubbles: true });
};

try {
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ronaStore?.getState().session, null, { timeout: 15000 });
  await sleep(1500);
  await shot('home');
  await store(() => window.__ronaStore.getState().updateProfile({ name: 'Adán', avatar: 3, color: '#ff6b00' }));
  await store(() => window.__ronaStore.getState().refreshRooms());
  await sleep(800);
  await shot('lobby');
  await store(() => window.__ronaStore.getState().createRoom('Desde el cel', 4));
  await page.locator('.seats').waitFor();
  for (let i = 0; i < 3; i++) await store(() => window.__ronaStore.getState().addBot('normal'));
  await sleep(900);
  await shot('room');

  await store(() => window.__ronaStore.getState().startGame());
  await page.locator('.gt-root:not(.gt-loading)').waitFor({ timeout: 10000 });
  await sleep(3000);
  await shot('table');

  // Presión larga: sale la ayuda y la carta NO queda elegida
  const first = page.locator('.gt-hand .gt-hand-card').first();
  await longPress(first);
  await sleep(200);
  if (await store(() => !!document.querySelector('.gt-hand .gt-hand-card.is-selected'))) problems.push('la presión larga eligió la carta');

  // Esperar mi turno y tocar una carta: destinos resaltados
  await page.waitForFunction(() => {
    const g = window.__ronaStore.getState().game;
    return g && g.turnPlayerId === g.you && !window.__ronaStore.getState().eventQueue.length;
  }, null, { timeout: 30000 });
  await sleep(1200);
  await page.locator('.gt-hand .gt-hand-card').first().tap();
  await sleep(700);
  await shot('selected');
  await page.getByRole('button', { name: 'Cancelar' }).tap().catch(() => {});

  await page.getByRole('button', { name: 'Emotes rápidos' }).tap();
  await sleep(400);
  await shot('emotes');
  await page.locator('.emote-pop .emote-btn').nth(1).tap();
  await sleep(500);
  await shot('emote-sent');

  // Jugar hasta el final
  let last = null;
  for (let guard = 0; guard < 500; guard++) {
    const s = await store(() => { const st = window.__ronaStore.getState(); return { g: st.game, q: st.eventQueue.length }; });
    if (s.g?.winner) break;
    if (s.g && s.g.turnPlayerId === s.g.you && s.q === 0 && s.g.turnNumber !== last) {
      last = s.g.turnNumber;
      if (last > 10 && last < 14) await shot('midgame');
      const action = chooseBotAction(s.g, s.g.you, { level: 'normal' });
      if (action) await store((a) => window.__ronaStore.getState().act(a).catch(() => {}), action);
    }
    await sleep(200);
  }
  await page.locator('.gt-end-card').waitFor({ timeout: 30000 });
  await sleep(2500);
  await shot('end');
} finally {
  await browser.close();
}
if (problems.length) { console.log('PROBLEMAS:\n' + problems.join('\n')); process.exitCode = 1; } else console.log('sin problemas');
