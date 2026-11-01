// Capturas y comprobaciones del frente de UI: control de volumen (lobby y mesa), pista en vertical,
// soltar en el panel y en el descarte, modal de fin en vertical, lobby en 360×740 y sala en 390×844.
//
//   node e2e/ui-shots.mjs      (servidor en :3001 y vite en :5173 ya corriendo)
//
// Deja e2e/shots/ui/*.png y termina con código 1 si algo no cuadra.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.E2E_URL || 'http://localhost:5173';
const SHOTS = fileURLToPath(new URL('./shots/ui/', import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const problems = [];
const only = process.argv[2] || 'all';

const browser = await chromium.launch({ headless: !process.env.HEADED, args: ['--autoplay-policy=no-user-gesture-required'] });

const open = async (viewport, url = BASE, mobile = false) => {
  const ctx = await browser.newContext({ viewport, ...(mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`consola (${viewport.width}): ${m.text()}`); });
  await page.goto(url);
  return { ctx, page };
};
const shotOf = (page) => async (name) => { await page.screenshot({ path: `${SHOTS}${name}.png` }); log('captura', name); };
const audio = (page) => page.evaluate(() => ({
  sfx: window.__ronaAudio?.sfxGain, music: window.__ronaAudio?.musicGain, state: window.__ronaAudio?.state,
  sfxTarget: window.__ronaAudio?.sfxTarget,
  vols: { ...window.__ronaAudio?.volumes },
}));
// Mueve un slider a un valor con el teclado (Home + flechas de 5 en 5)
const setRange = async (loc, value) => {
  await loc.focus();
  await loc.press('Home');
  for (let v = 0; v < value; v += 5) await loc.press('ArrowRight');
};

// ---------- 1) Volumen en el lobby: persistencia y ganancias ----------
const lobbyVolume = async () => {
  const { ctx, page } = await open({ width: 1280, height: 720 }, `${BASE}/?demo=lobby`);
  const shot = shotOf(page);
  await page.waitForSelector('.lobby__grid', { timeout: 15000 });
  await page.evaluate(() => { localStorage.removeItem('rona.vol.music'); localStorage.removeItem('rona.vol.sfx'); localStorage.setItem('rona.muted', '0'); });
  await page.reload();
  await page.waitForSelector('.lobby__grid');
  await sleep(800);
  const btn = page.locator('.topbar .vol-btn');
  await btn.click();
  await page.waitForSelector('.vol-pop');
  await sleep(400);
  await shot('vol-lobby-1280');
  const music = page.getByRole('slider', { name: 'Volumen de música' });
  const fx = page.getByRole('slider', { name: 'Volumen de efectos' });
  await setRange(music, 20);
  await setRange(fx, 85);
  await sleep(500);
  const a = await audio(page);
  log('ganancias', a);
  if (a.vols.music !== 20 || a.vols.sfx !== 85) problems.push(`volúmenes no aplicados: ${JSON.stringify(a.vols)}`);
  if (!(Math.abs(a.music - 0.2) < 0.03)) problems.push(`musicBus no bajó a 0.2: ${a.music}`);
  if (!(Math.abs(a.sfx - 0.45 * 0.85) < 0.03)) problems.push(`master de efectos no quedó en 0.38: ${a.sfx}`);
  await shot('vol-lobby-1280-ajustado');
  // Esc cierra y el foco vuelve al botón
  await page.keyboard.press('Escape');
  await sleep(300);
  if (await page.locator('.vol-pop').count()) problems.push('Esc no cerró el panel de volumen');
  if (!(await btn.evaluate((el) => el === document.activeElement))) problems.push('el foco no volvió al botón de volumen');
  // Recargar: se conserva
  await page.reload();
  await page.waitForSelector('.lobby__grid');
  await page.mouse.click(5, 300); // gesto para reanudar el AudioContext
  await sleep(800);
  const b = await audio(page);
  log('tras recargar', b);
  if (b.vols.music !== 20 || b.vols.sfx !== 85) problems.push(`no persistió el volumen: ${JSON.stringify(b.vols)}`);
  if (!(Math.abs(b.music - 0.2) < 0.03)) problems.push(`musicBus tras recargar: ${b.music}`);
  // Silenciar todo: ambas ganancias a 0; luego se quita
  await btn.click();
  await page.getByRole('switch', { name: /Silenciar todo/ }).click();
  await sleep(500);
  const c = await audio(page);
  if (c.music > 0.01 || c.sfxTarget > 0.01) problems.push(`silenciar todo no apagó: ${JSON.stringify(c)}`);
  await shot('vol-lobby-1280-silencio');
  await page.getByRole('switch', { name: /Silenciar todo/ }).click();
  // Clic fuera cierra
  await page.mouse.click(600, 600);
  await sleep(300);
  if (await page.locator('.vol-pop').count()) problems.push('clic fuera no cerró el panel');
  // Clic derecho silencia directo
  await btn.click({ button: 'right' });
  await sleep(300);
  if (!(await page.evaluate(() => localStorage.getItem('rona.muted') === '1'))) problems.push('clic derecho no silenció');
  await btn.click({ button: 'right' });
  await ctx.close();
};

// ---------- 2) Lobby y sala en vertical ----------
const lobbyPortrait = async () => {
  {
    const { ctx, page } = await open({ width: 360, height: 740 }, `${BASE}/?demo=lobby`, true);
    const shot = shotOf(page);
    await page.waitForSelector('.lobby__grid', { timeout: 15000 });
    await sleep(1200);
    await shot('lobby-360x740');
    // ¿Se ve el botón de crear sala sin scroll?
    const r = await page.locator('.create-room button[type=submit], .create-room .ui-btn').first().boundingBox();
    if (!r || r.y + r.height > 740) problems.push(`crear sala no se ve sin scroll en 360×740 (${r && Math.round(r.y + r.height)})`);
    await page.locator('.topbar .vol-btn').tap();
    await sleep(500);
    await shot('vol-lobby-390-hoja');
    await ctx.close();
  }
  {
    const { ctx, page } = await open({ width: 390, height: 844 }, BASE, true);
    const shot = shotOf(page);
    await page.waitForFunction(() => window.__ronaStore?.getState().session, null, { timeout: 15000 });
    await page.evaluate(() => window.__ronaStore.getState().updateProfile({ name: 'Maximiliano Ale', avatar: 3, color: '#ff6b00' }));
    await page.evaluate(() => window.__ronaStore.getState().createRoom('Sala vertical', 6));
    await page.locator('.seats').waitFor();
    for (let i = 0; i < 3; i++) await page.evaluate(() => window.__ronaStore.getState().addBot('normal'));
    await sleep(1200);
    await shot('sala-390x844');
    await page.locator('.topbar .vol-btn').tap();
    await sleep(500);
    await shot('vol-sala-390-hoja');
    await page.mouse.click(10, 10);
    await page.evaluate(() => window.__ronaStore.getState().leaveRoom());
    await ctx.close();
  }
};

// ---------- 3) La mesa (modo demo, sin servidor) ----------
const demoTable = async (viewport, tag, mobile) => {
  const { ctx, page } = await open(viewport, `${BASE}/?demo=game`, mobile);
  const shot = shotOf(page);
  await page.waitForSelector('.gt-root:not(.gt-loading)', { timeout: 15000 });
  await page.waitForFunction(() => window.__ronaDemo, null, { timeout: 10000 });
  await sleep(2500);
  // Volumen en la mesa
  await page.locator('.gt-controls .vol-btn').click();
  await sleep(500);
  await shot(`vol-mesa-${tag}`);
  await page.keyboard.press('Escape');
  await sleep(300);

  // Mi turno con la mano quieta
  const toMyTurn = async () => {
    await page.evaluate(() => window.__ronaDemo.run('myTurn'));
    await page.waitForFunction(() => {
      const s = window.__ronaStore.getState();
      return s.game && s.game.turnPlayerId === s.game.you && !s.eventQueue.length;
    }, null, { timeout: 20000 });
    await page.evaluate(() => window.__ronaDemo.pause());
    await sleep(1500);
  };
  await toMyTurn();

  // Una carta elegida: la pista (en vertical, en su franja) sin tapar mis ranuras
  const handIds = () => page.evaluate(() => window.__ronaStore.getState().game.hand.map((c) => ({ id: c.id, kind: c.kind, treatment: c.treatment, color: c.color })));
  const hand = await handIds();
  log('mano', hand.map((c) => c.kind + (c.color ? `:${c.color}` : '') + (c.treatment ? `:${c.treatment}` : '')).join(' '));
  const cardLoc = (id) => page.locator(`.gt-hand [data-card-id="${id}"]`);
  await cardLoc(hand[0].id).click();
  await sleep(700);
  await shot(`pista-${tag}`);
  if (mobile) {
    const hint = await page.locator('.gt-hint').boundingBox();
    const panel = await page.locator('.gt-me-panel').boundingBox();
    if (hint && panel && hint.y + hint.height > panel.y + 2) problems.push(`la pista tapa mi panel en vertical (${Math.round(hint.y + hint.height)} > ${Math.round(panel.y)})`);
    const fs = await page.locator('.gt-hint span:not(.gt-count)').evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    if (fs < 12) problems.push(`texto de la pista muy chico: ${fs}px`);
  }
  await page.keyboard.press('Escape');
  await sleep(300);

  // Arrastrar un órgano al borde de mi panel (no al hueco): se juega
  const drag = async (id, to) => {
    const b = await cardLoc(id).boundingBox();
    const from = { x: b.x + b.width / 2, y: b.y + b.height * 0.35 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      await page.mouse.move(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps);
      await sleep(16);
    }
    await sleep(250);
  };
  // Si no hay un órgano que pueda ir a mi cuerpo, tiro la mano hasta que salga uno
  const organOk = () => page.evaluate(() => {
    const g = window.__ronaStore.getState().game;
    const mine = new Set(g.players.find((p) => p.id === g.you).body.map((s) => s.organ?.color));
    return g.hand.find((c) => c.kind === 'organ' && !mine.has(c.color) && (c.color !== 'multi' || mine.size < 4))?.id || null;
  });
  let organId = await organOk();
  for (let i = 0; i < 8 && !organId; i++) {
    await page.evaluate(() => { window.__ronaDemo.resume(); const g = window.__ronaStore.getState().game; return window.__ronaStore.getState().act({ type: 'discard', cardIds: g.hand.map((c) => c.id) }); }).catch(() => {});
    await sleep(600);
    await toMyTurn();
    organId = await organOk();
  }
  const organ = organId && { id: organId };
  if (organ) {
    const panel = await page.locator('.gt-me-panel').boundingBox();
    const before = (await handIds()).length;
    await drag(organ.id, { x: panel.x + panel.width - 14, y: panel.y + 14 });
    await shot(`soltar-panel-${tag}`);
    const hovering = await page.locator('.gt-me-panel.is-hover').count();
    if (!hovering) problems.push(`el panel no se marcó como destino al arrastrar el órgano (${tag})`);
    await page.mouse.up();
    await sleep(1200);
    const still = (await handIds()).some((c) => c.id === organ.id);
    if (still) problems.push(`soltar en el panel no jugó el órgano (${tag}); mano ${before}`);
  } else log('no hay órgano en la mano: se salta soltar en el panel');

  // Arrastrar al descarte: se tira esa carta
  await toMyTurn();
  const hand2 = await handIds();
  const victim = hand2[hand2.length - 1];
  const disc = await page.locator('.gt-discard').boundingBox();
  await drag(victim.id, { x: disc.x + disc.width / 2, y: disc.y + disc.height / 2 });
  await shot(`soltar-descarte-${tag}`);
  if (!(await page.locator('.gt-root.is-over-discard').count())) problems.push(`el descarte no se marcó al pasar encima (${tag})`);
  await page.mouse.up();
  await sleep(1200);
  if ((await handIds()).some((c) => c.id === victim.id)) problems.push(`soltar en el descarte no tiró la carta (${tag})`);

  // Soltar en la nada: aviso neutro
  await toMyTurn();
  const hand3 = await handIds();
  const vw = viewport.width;
  await drag(hand3[0].id, { x: mobile ? vw - 20 : vw * 0.85, y: mobile ? viewport.height * 0.42 : viewport.height * 0.45 });
  await page.mouse.up();
  await sleep(250);
  await shot(`soltar-fuera-${tag}`);
  if (!(await page.locator('.gt-nudge').count())) problems.push(`no salió el aviso neutro al soltar fuera (${tag})`);
  await sleep(800);

  // Fin de la partida
  await page.evaluate(() => { window.__ronaDemo.resume(); window.__ronaDemo.run('win'); });
  await page.waitForSelector('.gt-end-card', { timeout: 20000 });
  await sleep(1600);
  await shot(`fin-${tag}`);
  await page.getByRole('button', { name: 'Ver mesa' }).click();
  await sleep(500);
  await shot(`fin-ver-mesa-${tag}`);
  if (!(await page.locator('.gt-end-pill').count())) problems.push('no salió la píldora de "Ver resultados"');
  await page.locator('.gt-end-pill').click();
  await sleep(600);
  if (!(await page.locator('.gt-end-card').count())) problems.push('la píldora no volvió a abrir los resultados');
  await ctx.close();
};

// ---------- 4) Extras de la mesa: chat, carta fuera de turno, "Descartarla" ----------
const tableExtras = async (viewport, tag, mobile) => {
  const { ctx, page } = await open(viewport, `${BASE}/?demo=game`, mobile);
  const shot = shotOf(page);
  await page.waitForSelector('.gt-root:not(.gt-loading)', { timeout: 15000 });
  await page.waitForFunction(() => window.__ronaDemo, null, { timeout: 10000 });
  await sleep(2500);
  await page.locator('.gt-controls .vol-btn').click();
  await sleep(500);
  await shot(`vol-mesa-${tag}`);
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.__ronaDemo.run('chat'));
  await page.getByRole('button', { name: 'Chat' }).click();
  await sleep(900);
  await shot(`chat-${tag}`);
  await page.getByRole('button', { name: 'Cerrar chat' }).click();
  await sleep(400);
  // Fuera de turno: tocar una carta no es un error
  await page.evaluate(() => {
    const s = window.__ronaStore.getState();
    if (s.game.turnPlayerId === s.game.you) return s.act({ type: 'discard', cardIds: [s.game.hand[0].id] }).catch(() => {});
    return null;
  });
  await page.waitForFunction(() => { const s = window.__ronaStore.getState(); return s.game.turnPlayerId !== s.game.you; }, null, { timeout: 20000 });
  await page.evaluate(() => window.__ronaDemo.pause());
  await sleep(1200);
  await sleep(300);
  await page.locator('.gt-hand .gt-hand-card').first().click();
  await sleep(350);
  await shot(`fuera-de-turno-${tag}`);
  const txt = await page.locator('.gt-hint').innerText();
  if (!/Podrás jugarla en tu turno/i.test(txt)) problems.push(`la pista no dijo "Podrás jugarla en tu turno" (${tag}): ${txt}`);
  if (await page.locator('.gt-toast.tone-error').count()) problems.push(`salió un toast rojo fuera de turno (${tag})`);
  // Carta sin destinos: botón "Descartarla". El trasplante sin pares (si no hay) o cualquiera sin destinos
  await page.evaluate(() => { window.__ronaDemo.resume(); window.__ronaDemo.run('myTurn'); });
  await page.waitForFunction(() => { const s = window.__ronaStore.getState(); return s.game.turnPlayerId === s.game.you && !s.eventQueue.length; }, null, { timeout: 20000 });
  await page.evaluate(() => window.__ronaDemo.pause());
  await sleep(1200);
  for (const el of await page.locator('.gt-hand .gt-hand-card').all()) {
    await el.click();
    await sleep(400);
    if (await page.getByRole('button', { name: 'Descartarla' }).count()) {
      await shot(`descartarla-${tag}`);
      break;
    }
    await page.keyboard.press('Escape');
    await sleep(200);
  }
  await ctx.close();
};

try {
  if (only === 'extras') {
    await tableExtras({ width: 1280, height: 720 }, '1280', false);
    await tableExtras({ width: 390, height: 844 }, '390b', true);
  }
  if (only === 'all' || only === 'lobby') await lobbyVolume();
  if (only === 'all' || only === 'portrait') await lobbyPortrait();
  if (only === 'all' || only === 'table') await demoTable({ width: 1440, height: 810 }, '1440', false);
  if (only === 'all' || only === 'table' || only === 'ptable') await demoTable({ width: 390, height: 844 }, '390', true);
} catch (err) {
  problems.push(`excepción: ${err.stack || err.message}`);
} finally {
  await browser.close();
}

if (problems.length) {
  console.log('\nPROBLEMAS:');
  for (const p of problems) console.log(' -', p);
  process.exit(1);
}
console.log('\nTodo bien. Capturas en', SHOTS);
