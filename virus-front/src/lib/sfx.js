// Efectos de sonido sintetizados con WebAudio (sin archivos de audio).
// Uso: import { sfx } from '../lib/sfx'; sfx.play();
// El silencio se guarda en localStorage['rona.muted'] y es el ÚNICO de la app: la música del lobby
// (features/lobby/music.jsx) lo lee de aquí y se entera de los cambios con onMuteChange.

const MUTE_KEY = 'rona.muted';

let ctx = null;
let master = null;
let muted = (() => {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
})();
const listeners = new Set();

// Crea (o reanuda) el AudioContext; los navegadores lo dejan suspendido hasta un gesto del usuario
const audio = () => {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.45;
    // Un compresor suave para que los sonidos encimados no saturen
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp);
    comp.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
};

if (typeof window !== 'undefined') {
  const unlock = () => audio();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
  window.addEventListener('keydown', unlock, { once: true, capture: true });
}

// Tono con envolvente: frecuencia inicial → final, tipo de onda, duración en segundos
const tone = ({ freq, to, type = 'sine', dur = 0.15, vol = 0.3, delay = 0, attack = 0.005, detune = 0 }) => {
  const ac = audio();
  if (!ac || muted) return;
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
  if (!ac || muted) return;
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
  if (master && ctx) master.gain.setTargetAtTime(muted ? 0 : 0.45, ctx.currentTime, 0.02);
  listeners.forEach((fn) => fn(muted));
};

export const toggleMute = () => setMuted(!muted);

// Para que la UI se entere de los cambios del silencio
export const onMuteChange = (fn) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};
