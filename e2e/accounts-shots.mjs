// Cuentas y amigos de punta a punta, con credenciales de prueba (AUTH_DEV_FAKE=1 en el servidor):
// Ana en escritorio (1440x810) y Beto en vertical (390x844). Ana entra, agrega a Beto por código,
// Beto acepta desde el aviso, Ana lo invita a su sala y Beto se une desde el toast.
//
//   cd virus-back && PORT=3101 AUTH_DEV_FAKE=1 DATA_DIR=/tmp/rona-e2e GOOGLE_CLIENT_ID=x.apps.googleusercontent.com node src/index.js
//   cd virus-front && VITE_SERVER_URL=http://localhost:3101 npx vite --port 5273
//   E2E_URL=http://localhost:5273 node e2e/accounts-shots.mjs
//
// Deja e2e/shots/acc-*.png. Con GOOGLE_CLIENT_ID (aunque sea falso) se ve el botón de Google.

import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_URL || 'http://localhost:5273';
const SHOTS = fileURLToPath(new URL('./shots/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];
const run = Date.now().toString(36); // subs distintos en cada corrida: cuentas nuevas

async function openPlayer(browser, name, viewport, mobile = false) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => {
    // GIS con un client ID falso se queja en consola: eso no es un fallo de la app
    if (m.type() === 'error' && !/accounts\.google\.com|GSI_LOGGER|client ID|403/i.test(m.text())) problems.push(`${name} consola: ${m.text()}`);
  });
  await page.goto(BASE);
  await page.waitForFunction(() => window.__ronaStore?.getState().session, null, { timeout: 15000 });
  await page.getByRole('button', { name: /Jugar/ }).click({ force: true });
  await page.locator('.profile-card').waitFor();
  const shot = async (label) => { await page.screenshot({ path: `${SHOTS}acc-${name}-${label}.png` }); log('captura', name, label); };
  const store = (fn, arg) => page.evaluate(fn, arg);
  return { ctx, page, shot, store };
}

const main = async () => {
  const browser = await chromium.launch({ headless: !process.env.HEADED });
  try {
    const ana = await openPlayer(browser, 'ana', { width: 1440, height: 810 });
    const beto = await openPlayer(browser, 'beto', { width: 390, height: 844 }, true);

    // Invitados: con GOOGLE_CLIENT_ID se ve el botón (el iframe de GIS) y el de amigos
    const hasClientId = await ana.store(() => !!window.__ronaStore.getState().authConfig.googleClientId);
    await sleep(1500);
    if (hasClientId && !(await ana.page.locator('.google-btn').count())) problems.push('no aparece el botón de Google');
    await ana.shot('1-invitado');
    await beto.shot('1-invitado');

    // Entrar con credencial de prueba
    await ana.store((sub) => window.__ronaStore.getState().loginGoogle(`dev:ana-${sub}:Ana`), run);
    await beto.store((sub) => window.__ronaStore.getState().loginGoogle(`dev:beto-${sub}:Beto`), run);
    await ana.page.locator('.account-stats').waitFor();
    await ana.page.locator('.avatar-picker__badge').waitFor();
    await sleep(600);
    await ana.shot('2-con-cuenta');
    await beto.page.locator('.account-stats').scrollIntoViewIfNeeded();
    await beto.shot('2-con-cuenta');

    // Ana agrega a Beto con su código desde el panel
    const betoCode = await beto.store(() => window.__ronaStore.getState().account.friendCode);
    await ana.page.getByRole('button', { name: /^Amigos/ }).click();
    await ana.page.locator('.friends').waitFor();
    await ana.page.locator('#friend-code-input').fill(betoCode.toLowerCase());
    await ana.page.getByRole('button', { name: 'Agregar' }).click();
    await ana.page.locator('.friends__pending li').waitFor();
    await sleep(500);
    await ana.shot('3-solicitud-enviada');

    // A Beto le llega el aviso con "Ver"; desde ahí acepta
    await beto.page.locator('.toast__action', { hasText: 'Ver' }).waitFor();
    await beto.page.locator('.friends-btn__badge').waitFor();
    await beto.shot('3-aviso-solicitud');
    await beto.page.locator('.toast__action', { hasText: 'Ver' }).click();
    await beto.page.locator('.friend-row.is-request').waitFor();
    await sleep(400);
    await beto.shot('4-solicitud');
    await beto.page.getByRole('button', { name: 'Aceptar' }).click();
    await beto.page.locator('.friend-row.is-online').waitFor();
    await sleep(500);
    await beto.shot('5-amigos');
    await beto.page.locator('.modal__close').click();

    // Ana ya ve a Beto en línea; crea su sala y lo invita
    await ana.page.locator('.friend-row.is-online').waitFor();
    await ana.page.locator('.modal__close').click();
    await ana.store(() => window.__ronaStore.getState().createRoom('Mesa de Ana', 4));
    await ana.page.locator('.seats').waitFor();
    await ana.page.getByRole('button', { name: /^Amigos/ }).click();
    await ana.page.getByRole('button', { name: 'Invitar' }).click();
    await sleep(500);
    await ana.shot('6-invitar');

    // Beto: toast "te invita" con "Unirse"
    await beto.page.locator('.toast__action', { hasText: 'Unirse' }).waitFor();
    await sleep(500);
    await beto.shot('6-invitacion');
    await beto.page.locator('.toast__action', { hasText: 'Unirse' }).click();
    await beto.page.locator('.seats').waitFor();
    const betoRoom = await beto.store(() => window.__ronaStore.getState().room?.name);
    if (betoRoom !== 'Mesa de Ana') problems.push(`Beto no quedó en la sala de Ana (${betoRoom})`);
    await ana.page.locator('.friend-row__status', { hasText: 'En tu sala' }).waitFor();
    await sleep(500);
    await ana.shot('7-en-tu-sala');
    await beto.shot('7-en-la-sala');

    // Partida: Ana gana por abandono de Beto → estadísticas
    await ana.page.locator('.modal__close').click();
    await ana.store(() => window.__ronaStore.getState().startGame());
    await beto.page.locator('.gt-root').waitFor({ timeout: 10000 });
    await sleep(1500);
    await beto.store(() => window.__ronaStore.getState().leaveRoom());
    await ana.page.waitForFunction(() => window.__ronaStore.getState().account?.stats.won === 1, null, { timeout: 10000 });
    const betoStats = await beto.store(() => window.__ronaStore.getState().account.stats);
    if (betoStats.played !== 1 || betoStats.won !== 0) problems.push(`estadísticas de Beto: ${JSON.stringify(betoStats)}`);
    await beto.page.locator('.account-stats').scrollIntoViewIfNeeded();
    await sleep(500);
    await beto.shot('8-estadisticas');

    // Recarga: el token de cuenta la recupera sola
    await beto.page.reload();
    await beto.page.waitForFunction(() => window.__ronaStore?.getState().account, null, { timeout: 15000 });
    // Cerrar sesión: vuelve a invitado
    await beto.page.getByRole('button', { name: /Jugar/ }).click({ force: true });
    await beto.page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await beto.page.waitForFunction(() => !window.__ronaStore.getState().account);
    await sleep(600);
    await beto.shot('9-logout');
  } finally {
    await browser.close();
  }
  if (problems.length) {
    console.log('PROBLEMAS:\n - ' + problems.join('\n - '));
    process.exitCode = 1;
  } else {
    log('Todo bien');
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
