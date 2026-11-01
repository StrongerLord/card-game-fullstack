// Graba una partida completa de un humano contra 3 bots, como la vería una persona, para videos.
//
//   MODE=desktop node e2e/gameplay-video.mjs   (1920×1080, cursor visible)
//   MODE=mobile  node e2e/gameplay-video.mjs   (390×844 a 2×, toques visibles)
//
// Necesita el servidor en :3001 y vite en :5173. El jugador decide con el bot 'normal' del motor y
// ejecuta la jugada con el ratón o el dedo en la interfaz. Deja e2e/video/gameplay-<modo>.webm (en
// celular, .mp4: el video de Playwright graba en píxeles CSS, así que se capturan los cuadros de
// Chrome a 2× y se arman con ffmpeg) y
// gameplay-<modo>.json con los momentos de la partida (segundos desde el inicio del video), que usa
// el promocional para escoger cortes.

import { chromium } from 'playwright';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chooseBotAction } from '../shared/engine/index.js';

const BASE = process.env.E2E_URL || 'http://localhost:5173';
const MODE = process.env.MODE === 'mobile' ? 'mobile' : 'desktop';
const MOBILE = MODE === 'mobile';
const NAME = process.env.PLAYER_NAME || 'Adán';
const OUT = fileURLToPath(new URL('./video/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const VIEW = MOBILE ? { width: 390, height: 844 } : { width: 1920, height: 1080 };
const VIDEO = MOBILE ? { width: 780, height: 1688 } : VIEW;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const log = (...a) => console.log(((Date.now() - t0) / 1000).toFixed(1).padStart(6), ...a);

// Cursor (escritorio) o círculo de toque (celular), para que se vea qué hace la persona
const pointerScript = (mobile) => `
  window.addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = '@keyframes vtap{from{transform:translate(-50%,-50%) scale(.4);opacity:.95}to{transform:translate(-50%,-50%) scale(1.5);opacity:0}}';
    document.head.appendChild(css);
    if (${mobile}) {
      window.addEventListener('pointerdown', (e) => {
        const d = document.createElement('div');
        d.style.cssText = 'position:fixed;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.55);border:3px solid #fff;box-shadow:0 0 0 2px rgba(60,25,170,.5);z-index:2147483647;pointer-events:none;animation:vtap .5s ease-out forwards;left:' + e.clientX + 'px;top:' + e.clientY + 'px';
        document.body.appendChild(d);
        setTimeout(() => d.remove(), 520);
      }, true);
      return;
    }
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;left:-50px;top:-50px;width:34px;height:34px;margin:-5px 0 0 -5px;z-index:2147483647;pointer-events:none;transition:transform .12s;filter:drop-shadow(0 3px 4px rgba(20,5,70,.45))';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="M3 2l7 19 2.5-7.5L20 11z" fill="#ffae00" stroke="white" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    window.addEventListener('mousemove', (e) => { c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    window.addEventListener('mousedown', () => { c.style.transform = 'scale(.75)'; }, true);
    window.addEventListener('mouseup', () => { c.style.transform = 'scale(1)'; }, true);
  });
`;

// Momentos de la partida: cada lote de eventos que llega, con su hora
const timelineScript = `
  window.__timeline = [];
  const hook = setInterval(() => {
    const st = window.__ronaStore;
    if (!st) return;
    clearInterval(hook);
    let seen = 0;
    st.subscribe((s) => {
      const q = s.eventQueue;
      const last = q[q.length - 1];
      if (last && last.seq !== seen) {
        seen = last.seq;
        window.__timeline.push({ at: Date.now(), you: s.game?.you, events: last.events.map((e) => ({ type: e.type, playerId: e.playerId, card: e.card && { kind: e.card.kind, treatment: e.card.treatment } })) });
      }
    });
  }, 50);
`;

const peek = (page) => page.evaluate(() => {
  const s = window.__ronaStore?.getState();
  if (!s) return null;
  return { game: s.game, queue: s.eventQueue.length, status: s.room?.status || null };
});

let page;
// Llega al elemento (con el cursor deslizándose, o con un toque) y lo activa
const press = async (loc, { dy = 0, steps = 22 } = {}) => {
  const el = loc.first();
  if ((await el.count()) === 0) return false;
  await el.scrollIntoViewIfNeeded().catch(() => {});
  const box = await el.boundingBox().catch(() => null);
  if (!box) return false;
  const x = box.x + box.width / 2;
  const y = box.y + Math.min(box.height / 2, box.height * 0.3 + dy);
  if (MOBILE) {
    await sleep(260);
    await page.touchscreen.tap(x, y);
    return true;
  }
  await page.mouse.move(x, y, { steps });
  await sleep(160);
  await page.mouse.click(x, y);
  return true;
};
const pressButton = (name) => press(page.getByRole('button', { name }));
const handCard = (id) => page.locator(`.gt-hand .gt-hand-card[data-card-id="${id}"]`);
const slot = (pid, sid) => page.locator(`[data-drop="slot"][data-pid="${pid}"][data-slot="${sid}"]`);

const perform = async (view, action) => {
  if (action.type === 'discard') {
    await pressButton('Descartar');
    await sleep(350);
    for (const id of action.cardIds) { await press(handCard(id)); await sleep(250); }
    await sleep(300);
    return pressButton(/^Tirar/);
  }
  if (action.type !== 'play') return false;
  const card = view.hand.find((c) => c.id === action.cardId);
  await press(handCard(action.cardId));
  await sleep(650); // que se vean los destinos resaltados
  const t = action.target || {};
  if (card.kind === 'organ') {
    return (await press(page.locator(`[data-drop="body"][data-pid="${view.you}"]`))) ||
      press(page.locator('[data-drop="table"]'));
  }
  if (card.kind === 'treatment') {
    switch (card.treatment) {
      case 'transplant':
        await press(slot(t.a.playerId, t.a.slotId));
        await sleep(500);
        return press(slot(t.b.playerId, t.b.slotId));
      case 'thief':
        return press(slot(t.playerId, t.slotId));
      case 'contagion':
        return pressButton('Contagiar');
      case 'glove':
        await pressButton('Usar guante');
        await sleep(400);
        return pressButton('¡Úsalo!');
      case 'medicalError':
        return press(page.locator(`[data-drop="player"][data-pid="${t.playerId}"]`));
    }
  }
  return press(slot(t.playerId, t.slotId));
};

// De vez en cuando, un emote: como lo haría alguien que juega con amigos
const emote = async (i) => {
  await pressButton('Emotes rápidos');
  await sleep(500);
  await press(page.locator('.emote-pop .emote-btn').nth(i));
  await sleep(400);
};

const main = async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: VIEW,
    ...(MOBILE ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}),
    ...(MOBILE ? {} : { recordVideo: { dir: OUT, size: VIDEO } }),
  });
  await ctx.addInitScript(pointerScript(MOBILE));
  await ctx.addInitScript(timelineScript);
  page = await ctx.newPage();
  const videoStart = Date.now();
  const video = page.video();
  // Celular: cuadros del screencast de Chrome con su hora, para armar el video a resolución real
  const FRAMES = `${OUT}frames-${MODE}/`;
  const frames = [];
  let cdp = null;
  if (MOBILE) {
    rmSync(FRAMES, { recursive: true, force: true });
    mkdirSync(FRAMES, { recursive: true });
    cdp = await ctx.newCDPSession(page);
    cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
      const file = `f${String(frames.length).padStart(6, '0')}.jpg`;
      writeFileSync(FRAMES + file, Buffer.from(data, 'base64'));
      frames.push({ file, t: metadata.timestamp });
      cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
    });
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 90, maxWidth: VIDEO.width, maxHeight: VIDEO.height });
  }
  page.on('pageerror', (e) => log('pageerror', e.message));
  const marks = [];
  const mark = (label) => { marks.push({ t: (Date.now() - videoStart) / 1000, label }); log('marca', label); };

  let won = false;
  try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__ronaStore?.getState().session, null, { timeout: 15000 });
    if (!MOBILE) await page.mouse.move(VIEW.width / 2, VIEW.height * 0.8);
    mark('portada');
    await sleep(3000); // que se luzca la portada
    await press(page.getByRole('button', { name: /Jugar/ }));
    const input = page.getByPlaceholder('¿Cómo te llamas?');
    await input.waitFor();
    mark('perfil');
    await sleep(700);
    await press(input);
    await input.press('Control+A');
    await input.press('Backspace');
    await input.pressSequentially(NAME, { delay: 110 });
    for (let i = 0; i < 2; i++) { await pressButton('Avatar siguiente'); await sleep(380); }
    await sleep(300);
    await pressButton('Guardar perfil');
    await page.waitForFunction((n) => window.__ronaStore.getState().profile.name === n, NAME, { timeout: 8000 });
    await sleep(800);

    // Sala de 4 con 3 bots
    const roomName = 'Noche de Roña';
    const roomInput = page.locator('form', { hasText: 'Crear sala' }).locator('input').first();
    await press(roomInput);
    await roomInput.pressSequentially(roomName, { delay: 80 });
    await press(page.getByRole('radio', { name: '4', exact: true }));
    await sleep(300);
    await pressButton('Crear sala');
    await page.getByRole('button', { name: /Empezar/ }).waitFor({ timeout: 8000 });
    mark('sala');
    await sleep(900);
    // Uno fácil y dos normales
    await press(page.getByRole('radio', { name: 'Fácil' }));
    await sleep(400);
    for (let i = 0; i < 3; i++) {
      if (i === 1) { await press(page.getByRole('radio', { name: 'Normal' })); await sleep(400); }
      await pressButton('Agregar bot');
      await sleep(900);
    }
    await sleep(1200);
    await pressButton(/Empezar/);
    await page.locator('.gt-root:not(.gt-loading)').waitFor({ timeout: 10000 });
    mark('reparto');
    await sleep(3000);

    // Partida
    let last = null;
    let plays = 0;
    for (;;) {
      const s = await peek(page).catch(() => null);
      if (!s?.game) { await sleep(200); continue; }
      const g = s.game;
      if (g.winner || s.status === 'finished') break;
      const mine = g.turnPlayerId === g.you;
      if (!mine || s.queue > 0 || g.turnNumber === last || !(await page.locator('.gt-root.is-my-turn').count())) {
        await sleep(150);
        continue;
      }
      last = g.turnNumber;
      await sleep(1100); // "pensando"
      const action = chooseBotAction(g, g.you, { level: 'normal' });
      if (!action) continue;
      plays++;
      const ok = await perform(g, action).catch(() => false);
      await sleep(1200);
      const after = await peek(page);
      if (!ok || (after.game.turnNumber === g.turnNumber && !after.game.winner)) {
        log(`la jugada por la interfaz no entró (${JSON.stringify(action).slice(0, 90)}); la mando directa`);
        if (!MOBILE) await page.keyboard.press('Escape');
        await page.evaluate((act) => window.__ronaStore.getState().act(act).catch(() => {}), action);
      }
      log(`turno ${g.turnNumber}: ${action.type} ${action.cardId || ''}`);
      if (plays === 3) await emote(4).catch(() => {}); // 😎
      if (plays === 9) await emote(2).catch(() => {}); // 😂
    }
    await page.locator('.gt-end-card').waitFor({ timeout: 20000 }).catch(() => {});
    mark('fin');
    const g = (await peek(page)).game;
    won = g.winner?.playerId === g.you;
    log(won ? 'ganó el humano' : `ganó ${g.winner?.playerId}`);
    await sleep(2500);
    if (won) await emote(7).catch(() => {}); // 👏
    else await emote(3).catch(() => {}); // 😭
    await sleep(6000); // confeti
  } finally {
    const timeline = await page.evaluate(() => window.__timeline).catch(() => []);
    if (cdp) await cdp.send('Page.stopScreencast').catch(() => {});
    await ctx.close();
    await browser.close();
    if (video) renameSync(await video.path(), `${OUT}gameplay-${MODE}.webm`);
    if (frames.length) {
      // Cada cuadro dura hasta el siguiente; ffmpeg lo pasa a 30 fps constantes
      const lines = frames.map((f, i) => `file '${f.file}'\nduration ${((frames[i + 1]?.t ?? f.t + 0.5) - f.t).toFixed(4)}`);
      writeFileSync(`${FRAMES}list.txt`, `${lines.join('\n')}\nfile '${frames.at(-1).file}'\n`);
      execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', `${FRAMES}list.txt`, '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '18', '-preset', 'medium', `${OUT}gameplay-${MODE}.mp4`], { stdio: 'inherit' });
      rmSync(FRAMES, { recursive: true, force: true });
    }
    // En celular el video arranca con el primer cuadro capturado
    const base = frames.length ? frames[0].t * 1000 : videoStart;
    for (const m of marks) m.t += (videoStart - base) / 1000;
    const moments = timeline.map((b) => ({ t: (b.at - base) / 1000, mine: b.events.some((e) => e.playerId === b.you && e.type === 'played'), types: [...new Set(b.events.map((e) => e.type))], treatments: b.events.map((e) => e.card?.treatment).filter(Boolean) }));
    writeFileSync(`${OUT}gameplay-${MODE}.json`, JSON.stringify({ mode: MODE, won, marks, moments }, null, 1));
    log('listo:', `${OUT}gameplay-${MODE}.${MOBILE ? 'mp4' : 'webm'}`);
  }
};

main();
