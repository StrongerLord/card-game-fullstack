// Efectos de sonido sintetizados con WebAudio (sin archivos de audio).
// Uso: import { sfx } from '../lib/sfx'; sfx.play();
// El silencio se guarda en localStorage['rona.muted'] y es el ÚNICO de la app ("Silenciar todo"): la música
// del lobby (features/lobby/music.jsx) lo lee de aquí y se entera de los cambios con onMuteChange.
// Además hay dos volúmenes (0–100) por separado, 'music' y 'sfx', en localStorage['rona.vol.music'|'rona.vol.sfx'].
// La música pasa por el mismo AudioContext (getAudioContext + musicBus), así su volumen también funciona en iOS.

const MUTE_KEY = 'rona.muted';
const VOL_KEYS = { music: 'rona.vol.music', sfx: 'rona.vol.sfx' };
const DEFAULT_VOL = 70;
const SFX_GAIN = 0.45; // ganancia de los efectos con el volumen al 100 %

let ctx = null;
let master = null;
let musicBus = null;
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
})();
const readVol = (kind) => {
  try {
    const v = Number(localStorage.getItem(VOL_KEYS[kind]));
    return localStorage.getItem(VOL_KEYS[kind]) !== null && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : DEFAULT_VOL;
  } catch { return DEFAULT_VOL; }
};
const volumes = { music: readVol('music'), sfx: readVol('sfx') };
const listeners = new Set();
const volListeners = new Set();

const sfxTarget = () => (muted ? 0 : SFX_GAIN * (volumes.sfx / 100));
const musicTarget = () => (muted ? 0 : volumes.music / 100);

// Lleva las ganancias a su valor con una rampa corta (sin chasquidos)
const applyGains = () => {
  if (!ctx) return;
  master?.gain.setTargetAtTime(sfxTarget(), ctx.currentTime, 0.05);
  musicBus?.gain.setTargetAtTime(musicTarget(), ctx.currentTime, 0.05);
};

// Crea el AudioContext (sin reanudarlo). Se llama en un momento ocioso al cargar la página, para que
// nunca se cree en medio de un lote de animaciones (era una tarea larga de ~100 ms).
const ensureContext = () => {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch { return null; }
    master = ctx.createGain();
    master.gain.value = sfxTarget();
    // Un compresor suave para que los sonidos encimados no saturen
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
    // La música va directo a la salida: no debe disparar el compresor de los efectos
    musicBus = ctx.createGain();
    musicBus.gain.value = musicTarget();
    musicBus.connect(ctx.destination);
  }
  return ctx;
};

// Contexto listo para sonar; los navegadores lo dejan suspendido hasta un gesto del usuario
const audio = () => {
  const ac = ensureContext();
  if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  return ac;
};

if (typeof window !== 'undefined') {
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 500));
  idle(() => ensureContext());
  // En el gesto sólo se reanuda (el contexto ya existe casi siempre)
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}

// Para la música del lobby: el mismo contexto y el bus con el volumen de la música
export const getAudioContext = () => ensureContext();
export const getMusicBus = () => (ensureContext() ? musicBus : null);

// Tono con envolvente: frecuencia inicial → final, tipo de onda, duración en segundos
const tone = ({ freq, to, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005, detune = 0 }) => {
  const ac = audio();
  if (!ac || muted || volumes.sfx === 0) return;
  const t0 = ac.currentTime + delay;
  const osc = ac.createOscillator();
  const gain = ac.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(gain);
  gain.connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
};

let noiseBuffer = null;
const getNoise = (ac) => {
  if (noiseBuffer) return noiseBuffer;
  noiseBuffer = ac.createBuffer(1, ac.sampleRate * 1.5, ac.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return noiseBuffer;
};

// Ruido filtrado (soplidos, explosiones, barajeos)
const noise = ({ dur = 0.2, vol = 0.25, freq = 1200, to, filter = 'bandpass', q = 1, delay = 0, attack = 0.005 }) => {
  const ac = audio();
  if (!ac || muted || volumes.sfx === 0) return;
  const t0 = ac.currentTime + delay;
  const src = ac.createBufferSource();
  src.buffer = getNoise(ac);
  const biquad = ac.createBiquadFilter();
  biquad.type = filter;
  biquad.Q.value = q;
  biquad.frequency.setValueAtTime(freq, t0);
  if (to) biquad.frequency.exponentialRampToValueAtTime(Math.max(20, to), t0 + dur);
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(vol, t0 + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(biquad);
  biquad.connect(gain);
  gain.connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.05);
};

const notes = (list, { type = 'triangle', step = 0.08, dur = 0.18, vol = 0.22, delay = 0 } = {}) =>
  list.forEach((f, i) => tone({ freq: f, type, dur, vol, delay: delay + i * step }));

export const sfx = {
  // Seleccionar una carta: un "blip" corto
  select: () => tone({ freq: 620, to: 940, type: 'triangle', dur: 0.08, vol: 0.18 }),
  // Pasar el ratón por una carta: casi inaudible
  hover: () => tone({ freq: 1400, type: 'sine', dur: 0.03, vol: 0.04 }),
  // Jugar una carta: soplido + golpe
  play: () => {
    noise({ dur: 0.22, vol: 0.18, freq: 600, to: 3200, q: 0.8 });
    tone({ freq: 180, to: 70, type: 'sine', dur: 0.16, vol: 0.35, delay: 0.12 });
  },
  // Infectar: chapoteo viscoso
  infect: () => {
    tone({ freq: 260, to: 90, type: 'sawtooth', dur: 0.28, vol: 0.12 });
    tone({ freq: 300, to: 110, type: 'square', dur: 0.22, vol: 0.06, delay: 0.05, detune: 30 });
    noise({ dur: 0.25, vol: 0.12, freq: 400, to: 150, filter: 'lowpass', delay: 0.02 });
  },
  // Órgano destruido: explosión
  destroy: () => {
    noise({ dur: 0.7, vol: 0.5, freq: 2400, to: 80, filter: 'lowpass', q: 0.7 });
    tone({ freq: 140, to: 35, type: 'sine', dur: 0.6, vol: 0.5 });
    tone({ freq: 90, to: 30, type: 'triangle', dur: 0.5, vol: 0.3, delay: 0.05 });
  },
  // Curar: arpegio ascendente brillante
  cure: () => notes([523, 659, 784, 1047], { type: 'sine', step: 0.06, dur: 0.22, vol: 0.18 }),
  // Vacunar: un "ding"
  vaccinate: () => {
    tone({ freq: 1175, type: 'sine', dur: 0.4, vol: 0.18 });
    tone({ freq: 1760, type: 'sine', dur: 0.3, vol: 0.08, delay: 0.02 });
  },
  // Inmunizar: acorde dorado con destellos
  immunize: () => {
    [523, 659, 784, 1047].forEach((f) => tone({ freq: f, type: 'triangle', dur: 0.9, vol: 0.1, attack: 0.03 }));
    notes([1568, 2093, 2637, 3136], { type: 'sine', step: 0.07, dur: 0.25, vol: 0.08, delay: 0.15 });
  },
  // Robar: barajeo corto
  draw: () => {
    noise({ dur: 0.09, vol: 0.12, freq: 3000, filter: 'highpass' });
    noise({ dur: 0.08, vol: 0.08, freq: 4000, filter: 'highpass', delay: 0.06 });
  },
  // Intercambio (trasplante, ladrón, error médico, guante)
  swap: () => {
    noise({ dur: 0.35, vol: 0.2, freq: 300, to: 2500, q: 1.2 });
    tone({ freq: 400, to: 800, type: 'triangle', dur: 0.25, vol: 0.08, delay: 0.1 });
  },
  // Empieza mi turno: campanita de dos notas
  turn: () => {
    tone({ freq: 880, type: 'sine', dur: 0.25, vol: 0.2 });
    tone({ freq: 1320, type: 'sine', dur: 0.4, vol: 0.2, delay: 0.12 });
  },
  // Tic de los últimos 5 segundos
  tick: () => tone({ freq: 1250, type: 'square', dur: 0.035, vol: 0.07 }),
  // Victoria: fanfarria
  win: () => {
    notes([523, 659, 784, 1047], { type: 'square', step: 0.12, dur: 0.16, vol: 0.09 });
    [523, 659, 784, 1047].forEach((f) => tone({ freq: f, type: 'triangle', dur: 1.1, vol: 0.1, delay: 0.5, attack: 0.02 }));
    notes([2093, 2637, 3136], { type: 'sine', step: 0.06, dur: 0.2, vol: 0.06, delay: 0.55 });
  },
  // Derrota: trombón triste
  lose: () => {
    [392, 370, 349].forEach((f, i) => tone({ freq: f, type: 'sawtooth', dur: 0.3, vol: 0.09, delay: i * 0.32 }));
    tone({ freq: 330, to: 300, type: 'sawtooth', dur: 0.9, vol: 0.09, delay: 0.96 });
  },
  // Error (jugada ilegal)
  error: () => {
    tone({ freq: 150, type: 'square', dur: 0.12, vol: 0.09 });
    tone({ freq: 120, type: 'square', dur: 0.16, vol: 0.09, delay: 0.1 });
  },
  // Clic de botón / mensaje de chat
  click: () => tone({ freq: 760, type: 'triangle', dur: 0.05, vol: 0.12 }),
  message: () => notes([988, 1319], { type: 'sine', step: 0.07, dur: 0.12, vol: 0.1 }),
  emote: () => tone({ freq: 520, to: 1180, type: 'sine', dur: 0.12, vol: 0.13 }),
};

export const isMuted = () => muted;

export const setMuted = (value) => {
  muted = !!value;
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
  applyGains();
  listeners.forEach((fn) => fn(muted));
};

export const toggleMute = () => setMuted(!muted);

// Para que la UI se entere de los cambios del silencio
export const onMuteChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

// Volumen de 0 a 100 de 'music' o 'sfx'
export const getVolume = (kind) => volumes[kind] ?? DEFAULT_VOL;

export const setVolume = (kind, value) => {
  if (!(kind in volumes)) return;
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  if (v === volumes[kind]) return;
  volumes[kind] = v;
  try { localStorage.setItem(VOL_KEYS[kind], String(v)); } catch { /* sin almacenamiento */ }
  applyGains();
  volListeners.forEach((fn) => fn(kind, v));
};

// Para que la UI (y la música) se enteren de los cambios de volumen: fn(kind, valor)
export const onVolumeChange = (fn) => {
  volListeners.add(fn);
  return () => volListeners.delete(fn);
};

// En desarrollo, para las pruebas de Playwright: lee las ganancias reales y las de destino
// (Chrome no actualiza gain.value de un nodo sin nada sonando, por eso también van los objetivos)
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  window.__ronaAudio = {
    get sfxGain() { return master?.gain.value ?? null; },
    get musicGain() { return musicBus?.gain.value ?? null; },
    get sfxTarget() { return sfxTarget(); },
    get musicTarget() { return musicTarget(); },
    get state() { return ctx?.state ?? null; },
    volumes,
  };
}
