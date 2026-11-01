// Arma los tres videos finales con ffmpeg a partir de las grabaciones de e2e/gameplay-video.mjs y las
// piezas de e2e/promo-cards.mjs:
//
//   node e2e/promo-build.mjs   → e2e/video/out/rona-promo.mp4      (vertical 1080×1920, ~45 s)
//                                 e2e/video/out/rona-partida-compu.mp4   (1920×1080)
//                                 e2e/video/out/rona-partida-celular.mp4 (vertical)
//
// Los cortes del promocional están elegidos a mano sobre gameplay-*.json (segundos del video).

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const V = fileURLToPath(new URL('./video/', import.meta.url));
const OUT = `${V}out/`;
const TMP = `${V}out/tmp/`;
mkdirSync(TMP, { recursive: true });
const MUSIC = fileURLToPath(new URL('../virus-front/src/assets/roña soundtrack.mp3', import.meta.url));
const MOBILE = `${V}gameplay-mobile.mp4`;
const DESKTOP = `${V}gameplay-desktop.webm`;
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const probe = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString());
const ENC = ['-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30'];
// Las partidas completas duran minutos: más comprimidas para que se puedan mandar
const ENC_LONG = ['-c:v', 'libx264', '-crf', '24', '-preset', 'slow', '-tune', 'animation', '-pix_fmt', 'yuv420p', '-r', '30'];
const BG = '0x5b2fd8';

const ONLY_LONG = process.argv.includes('--partidas');

// ---------- Promocional ----------
const SEGMENTS = [
  { kind: 'card', file: `${V}promo/intro.webm`, from: 0.25, len: 3.6 },
  { kind: 'mobile', from: 59, len: 4.5, cap: 'cap-arma' },
  { kind: 'mobile', from: 136, len: 5, cap: 'cap-ataca' },
  { kind: 'mobile', from: 156, len: 5.5, cap: 'cap-trampas' },
  { kind: 'mobile', from: 229.5, len: 4.5, cap: 'cap-bots' },
  { kind: 'desktop', from: 229.5, len: 5.5, cap: 'cap-compu' },
  { kind: 'mobile', from: 632.5, len: 9.5, cap: 'cap-gana' },
  { kind: 'card', file: `${V}promo/outro.webm`, from: 0.2, len: 6.8 },
];
const FADE = 0.3; // transición entre cortes

// Letrero que entra con un fundido
const capIn = (i) => `[${i}:v]format=rgba,fade=in:st=0.15:d=0.3:alpha=1[cap]`;

if (!ONLY_LONG) buildPromo();
function buildPromo() {
const parts = SEGMENTS.map((s, i) => {
  const out = `${TMP}seg${i}.mp4`;
  if (s.kind === 'card') {
    ff('-ss', String(s.from), '-t', String(s.len), '-i', s.file, '-vf', 'scale=1080:1920,fps=30', '-an', ...ENC, out);
  } else if (s.kind === 'mobile') {
    // El celular abajo del letrero, sobre la misma toma desenfocada
    ff('-ss', String(s.from), '-t', String(s.len), '-i', MOBILE, '-loop', '1', '-t', String(s.len), '-i', `${V}promo/${s.cap}.png`, '-filter_complex',
      `[0:v]split[a][b];[a]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:2,eq=brightness=-0.12[bg];` +
      `[b]scale=-2:1600[fg];[bg][fg]overlay=(W-w)/2:300[base];${capIn(1)};[base][cap]overlay=0:0,fps=30[v]`,
      '-map', '[v]', '-an', ...ENC, out);
  } else {
    // La compu dentro de un marco, centrada
    ff('-ss', String(s.from), '-t', String(s.len), '-i', DESKTOP, '-loop', '1', '-t', String(s.len), '-i', `${V}promo/${s.cap}.png`, '-filter_complex',
      `color=c=${BG}:s=1080x1920:d=${s.len}[bg];[0:v]scale=1040:-2,pad=iw+16:ih+16:8:8:color=0x2a1a5e[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2+40[base];${capIn(1)};[base][cap]overlay=0:0,fps=30[v]`,
      '-map', '[v]', '-an', ...ENC, out);
  }
  return { out, len: s.len };
});

// Cortes unidos con fundidos cortos y la música encima
const inputs = parts.flatMap((p) => ['-i', p.out]);
let chain = '';
let prev = '[0:v]';
let offset = 0;
for (let i = 1; i < parts.length; i++) {
  offset += parts[i - 1].len - FADE;
  const label = i === parts.length - 1 ? '[v]' : `[x${i}]`;
  chain += `${prev}[${i}:v]xfade=transition=fade:duration=${FADE}:offset=${offset.toFixed(3)}${label};`;
  prev = label;
}
const total = parts.reduce((a, p) => a + p.len, 0) - FADE * (parts.length - 1);
ff(...inputs, '-i', MUSIC, '-filter_complex',
  `${chain}[${parts.length}:a]atrim=0:${total.toFixed(2)},afade=t=in:d=0.4,afade=t=out:st=${(total - 2).toFixed(2)}:d=2,volume=0.9[a]`,
  '-map', '[v]', '-map', '[a]', ...ENC, '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', `${OUT}rona-promo.mp4`);
console.log('promo', total.toFixed(1), 's');
}

// ---------- Partidas completas, con la música en loop debajo ----------
const withMusic = (src, out, vf) => {
  const len = probe(src);
  ff('-i', src, '-stream_loop', '-1', '-i', MUSIC, '-filter_complex',
    `[0:v]${vf},fps=30[v];[1:a]atrim=0:${len.toFixed(2)},afade=t=in:d=1,afade=t=out:st=${(len - 3).toFixed(2)}:d=3,volume=0.55[a]`,
    '-map', '[v]', '-map', '[a]', ...ENC_LONG, '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  console.log(out, len.toFixed(1), 's');
};
withMusic(DESKTOP, `${OUT}rona-partida-compu.mp4`, 'scale=1920:1080');
withMusic(MOBILE, `${OUT}rona-partida-celular.mp4`, 'scale=780:-2');
writeFileSync(`${TMP}.done`, '');
