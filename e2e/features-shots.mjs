// Capturas de las funciones nuevas: emotes (lobby y mesa), reacciones de los bots, ayuda de las cartas,
// marcador de victorias y coronas en los avatares.
//
//   node e2e/features-shots.mjs      (servidor en :3001 y vite en :5173 ya corriendo)
//
// Un humano (que juega con el bot 'normal' del motor) contra 2 bots. Deja e2e/shots/feat-*.png.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chooseBotAction } from '../shared/engine/index.js';

const BASE = process.env.E2E_URL || 'http://localhost:5173';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];

const main = async () => {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  const page = await browser.newPage({ viewport: { width: 1440, height: 810 } });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`consola: ${m.text()}`); });
  const shot = async (name) => { await page.screenshot({ path: `${SHOTS}feat-${name}.png` }); log('captura', name); };
  const store = (fn, arg) => page.evaluate(fn, arg);

  try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__ronaStore?.getState().session, null, { timeout: 15000 });
    await store(() => window.__ronaStore.getState().updateProfile({ name: 'Adán', avatar: 3, color: '#ff6b00' }));
    await store(() => window.__ronaStore.getState().createRoom('Emotes y marcador', 3));
    await page.locator('.seats').waitFor();
    await store(() => window.__ronaStore.getState().addBot('normal'));
    await store(() => window.__ronaStore.getState().addBot('normal'));
    await sleep(800);

    // Emote desde la fila del chat de la sala
    await page.locator('.chat__emotes .emote-btn').nth(2).click();
    await sleep(500);
    await shot('lobby-emote');

    // A la mesa
    await store(() => window.__ronaStore.getState().startGame());
    await page.locator('.gt-root:not(.gt-loading)').waitFor({ timeout: 10000 });
    await sleep(2500);

    // Ayuda de una carta de la mano: el puntero encima un momento
    const card = page.locator('.gt-hand .gt-hand-card').first();
    const box = await card.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3, { steps: 6 });
    await sleep(900);
    if (!(await page.locator('.card-tip').count())) problems.push('no salió la ayuda de la carta de la mano');
    await shot('tip-hand');
    await page.mouse.move(5, 400);
    await sleep(300);

    // Picker de emotes de la mesa y uno mandado
    await page.getByRole('button', { name: 'Emotes rápidos' }).click();
    await sleep(400);
    await shot('picker');
    await page.locator('.emote-pop .emote-btn').first().click();
    await sleep(450);
    await shot('my-emote');

    // Jugar hasta el final; capturar una reacción de bot con frase y la ayuda de un órgano en la mesa
    let gotBotSay = false;
    let gotOrganTip = false;
    let last = null;
    for (let guard = 0; guard < 1600; guard++) {
      const s = await store(() => {
        const st = window.__ronaStore.getState();
        return { g: st.game, q: st.eventQueue.length };
      });
      const g = s.g;
      if (g?.winner) break;
      if (!gotBotSay && (await page.locator('.gt-seat .emote-bubble').count())) {
        await sleep(250);
        await shot('bot-reaction');
        gotBotSay = true;
      }
      if (!gotOrganTip && g && g.turnNumber > 8) {
        const organ = page.locator('.gt-seat .gt-slot [data-card-id]').first();
        if (await organ.count()) {
          const b = await organ.boundingBox();
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 4 });
          await sleep(900);
          await shot('tip-organ');
          await page.mouse.move(5, 400);
          gotOrganTip = true;
        }
      }
      if (g && g.turnPlayerId === g.you && s.q === 0 && g.turnNumber !== last) {
        last = g.turnNumber;
        await sleep(600);
        const action = chooseBotAction(g, g.you, { level: 'normal' });
        if (action) await store((a) => window.__ronaStore.getState().act(a).catch(() => {}), action);
      }
      await sleep(250);
    }
    if (!gotBotSay) problems.push('no se vio ninguna reacción de bot');

    await page.locator('.gt-end-card').waitFor({ timeout: 30000 });
    await sleep(2500);
    await shot('end-scoreboard');

    // Revancha y nueva partida: el ganador lleva su corona en el avatar
    await page.getByRole('button', { name: 'Revancha' }).click();
    await page.locator('.seats').waitFor({ timeout: 8000 });
    await sleep(900);
    await shot('lobby-wins');
    await store(() => window.__ronaStore.getState().startGame());
    await page.locator('.gt-root:not(.gt-loading)').waitFor({ timeout: 10000 });
    await sleep(2500);
    if (!(await page.locator('.gt-badge-wins').count())) problems.push('no aparece la corona en la mesa');
    await shot('table-wins');
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.log('PROBLEMAS:\n' + problems.join('\n'));
    process.exitCode = 1;
  } else log('sin problemas');
};

main();
