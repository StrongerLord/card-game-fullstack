// Piezas gráficas del video promocional (vertical 1080×1920), hechas con HTML y la tipografía del juego:
// intro animada y cierre animado (se graban como video) y letreros transparentes para los cortes.
//
//   node e2e/promo-cards.mjs      → e2e/video/promo/{intro,outro}.webm y cap-*.png

import { chromium } from 'playwright';
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const OUT = fileURLToPath(new URL('./video/promo/', import.meta.url));
mkdirSync(OUT, { recursive: true });
const asset = (p) => pathToFileURL(fileURLToPath(new URL(`../virus-front/${p}`, import.meta.url))).href;
const card = (n) => asset(`src/assets/Cards/${n}_big.png`);
const URL_TEXT = process.env.PROMO_URL || 'rona.1200602.xyz';
// Las páginas se abren desde un archivo para que puedan cargar las imágenes y la fuente locales
const show = async (page, name, html) => {
  writeFileSync(`${OUT}${name}.html`, `<!doctype html><meta charset="utf-8">${html}`);
  await page.goto(pathToFileURL(`${OUT}${name}.html`).href);
  await page.evaluate(() => document.fonts.ready);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BASE_CSS = `
  @font-face { font-family: 'super_sedan'; src: url('${asset('public/super_sedan-webfont.woff2')}') format('woff2'); }
  * { box-sizing: border-box; margin: 0; }
  html, body { width: 540px; height: 960px; overflow: hidden; }
  body { font-family: 'super_sedan', sans-serif; color: #fff; }
  .bg { position: absolute; inset: 0; background: radial-gradient(circle at 50% 38%, #a07dff 0%, #885ffe 38%, #5b2fd8 100%); }
  .bg::after { content: ''; position: absolute; inset: 0; background: url('${asset('src/assets/doodles.png')}') center/520px repeat; opacity: .13; }
  .rays { position: absolute; left: 50%; top: 38%; width: 1400px; height: 1400px; translate: -50% -50%;
    background: repeating-conic-gradient(rgba(255,255,255,.09) 0 10deg, transparent 10deg 20deg); animation: spin 18s linear infinite; }
  @keyframes spin { to { rotate: 360deg; } }
  .stroke { -webkit-text-stroke: 7px #2a1a5e; paint-order: stroke fill; text-shadow: 0 7px 0 #2a1a5e; }
`;

const INTRO = `
  <style>${BASE_CSS}
  .logo { position: absolute; left: 50%; top: 33%; width: 440px; translate: -50% -50%; animation: pop .7s cubic-bezier(.34,1.56,.64,1) .35s both; filter: drop-shadow(0 12px 0 rgba(42,26,94,.6)); }
  @keyframes pop { from { scale: .2; rotate: -12deg; opacity: 0; } to { scale: 1; rotate: 0deg; opacity: 1; } }
  .tag { position: absolute; left: 0; right: 0; top: 47%; text-align: center; font-size: 38px; line-height: 1.15; animation: up .5s ease-out 1s both; }
  @keyframes up { from { translate: 0 30px; opacity: 0; } to { translate: 0 0; opacity: 1; } }
  .cards { position: absolute; left: 50%; top: 79%; }
  .cards img { position: absolute; width: 150px; translate: -50% -50%; border-radius: 14px; box-shadow: 0 12px 24px rgba(20,5,70,.45);
    animation: deal .6s cubic-bezier(.34,1.4,.64,1) both; }
  @keyframes deal { from { translate: -50% 420px; rotate: 0deg; opacity: 0; } }
  </style>
  <div class="bg"></div><div class="rays"></div>
  <img class="logo" src="${asset('src/assets/roña.png')}">
  <div class="tag stroke">El juego de cartas<br>más contagioso</div>
  <div class="cards">
    ${['organRed', 'ronaGreen', 'healBlue', 'starSteal', 'organYellow'].map((n, i) => `<img src="${card(n)}" style="left:${(i - 2) * 92}px;top:${Math.abs(i - 2) * 22}px;rotate:${(i - 2) * 12}deg;animation-delay:${1.25 + i * 0.12}s">`).join('')}
  </div>
`;

const OUTRO = `
  <style>${BASE_CSS}
  .logo { position: absolute; left: 50%; top: 20%; width: 330px; translate: -50% -50%; animation: pop .6s cubic-bezier(.34,1.56,.64,1) .2s both; filter: drop-shadow(0 10px 0 rgba(42,26,94,.6)); }
  @keyframes pop { from { scale: .2; opacity: 0; } to { scale: 1; opacity: 1; } }
  .big { position: absolute; left: 0; right: 0; top: 30%; text-align: center; font-size: 50px; line-height: 1.05; animation: up .5s ease-out .6s both; }
  .chips { position: absolute; left: 0; right: 0; top: 50%; display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .chip { background: #fff; color: #3c19aa; border: 4px solid #2a1a5e; box-shadow: 0 6px 0 #2a1a5e; border-radius: 999px; padding: 10px 26px; font-size: 26px; animation: up .45s ease-out both; }
  .url { position: absolute; left: 50%; top: 82%; transform: translate(-50%, -50%); white-space: nowrap; background: #ffae00; color: #2a1a5e; border: 5px solid #2a1a5e; box-shadow: 0 9px 0 #2a1a5e;
    border-radius: 22px; padding: 16px 24px; font-size: 30px; animation: up .5s ease-out 1.9s both, beat 1s ease-in-out 2.6s infinite; }
  @keyframes up { from { translate: 0 30px; opacity: 0; } to { translate: 0 0; opacity: 1; } }
  @keyframes beat { 50% { scale: 1.07; } }
  </style>
  <div class="bg"></div><div class="rays"></div>
  <img class="logo" src="${asset('src/assets/roña.png')}">
  <div class="big stroke">¡Ven a jugar<br>con tus amigos!</div>
  <div class="chips">
    <div class="chip" style="animation-delay:1.0s">Gratis · sin descargar nada</div>
    <div class="chip" style="animation-delay:1.2s">De 2 a 6 jugadores</div>
    <div class="chip" style="animation-delay:1.4s">En el cel o en la compu</div>
  </div>
  <div class="url">${URL_TEXT}</div>
`;

// Letreros para encima de los cortes (fondo transparente)
const CAPTIONS = {
  'cap-arma': ['Arma tu cuerpo', 'con 4 órganos sanos'],
  'cap-ataca': ['¡Llénales de roña', 'los órganos a tus amigos!'],
  'cap-trampas': ['Roba, trasplanta', 'y haz trampa (de la legal)'],
  'cap-bots': ['Juega con amigos', 'o contra bots con actitud'],
  'cap-compu': ['O desde la compu', 'con tus amigos en línea'],
  'cap-gana': ['El primero sano', 'se lleva la corona'],
};
const caption = ([a, b]) => `
  <style>${BASE_CSS}
  html, body { background: transparent; }
  .cap { position: absolute; left: 0; right: 0; top: 34px; text-align: center; }
  .a { display: inline-block; background: #ffae00; color: #2a1a5e; border: 4px solid #2a1a5e; box-shadow: 0 6px 0 #2a1a5e; border-radius: 18px; padding: 8px 20px; font-size: 38px; rotate: -2deg; }
  .b { margin-top: 12px; font-size: 32px; }
  </style>
  <div class="cap"><div class="a">${a}</div><div class="b stroke">${b}</div></div>
`;

const main = async () => {
  const browser = await chromium.launch();
  // Letreros
  const still = await browser.newPage({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2 });
  for (const [name, lines] of Object.entries(CAPTIONS)) {
    await show(still, 'caption', caption(lines));
    await sleep(150);
    await still.screenshot({ path: `${OUT}${name}.png`, omitBackground: true });
  }
  // Intro y cierre animados: se graban con el video de Playwright
  for (const [name, html, ms] of [['intro', INTRO, 3600], ['outro', OUTRO, 6000]]) {
    const dir = `${OUT}tmp-${name}/`;
    const ctx = await browser.newContext({ viewport: { width: 1080, height: 1920 }, recordVideo: { dir, size: { width: 1080, height: 1920 } } });
    const page = await ctx.newPage();
    // El video de Playwright graba en píxeles CSS: la página se dibuja al doble con zoom
    await show(page, name, `<style>html { zoom: 2; }</style>${html}`);
    await sleep(ms);
    await ctx.close();
    const file = readdirSync(dir).find((f) => f.endsWith('.webm'));
    renameSync(dir + file, `${OUT}${name}.webm`);
    rmSync(dir, { recursive: true, force: true });
  }
  await browser.close();
  for (const f of readdirSync(OUT)) if (f.endsWith('.html')) rmSync(OUT + f);
  console.log('piezas en', OUT);
};

main();
