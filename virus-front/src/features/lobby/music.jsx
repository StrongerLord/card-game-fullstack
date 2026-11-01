import { useEffect } from 'react';
import { create } from 'zustand';
import soundtrack from '../../assets/roña soundtrack.mp3';
import { VolumeControl } from './VolumeControl';
import { isMuted, onMuteChange, toggleMute, getVolume, onVolumeChange, getAudioContext, getMusicBus } from '../../lib/sfx';

// Música del lobby: un único <audio> compartido entre pantallas,
// tolerante al bloqueo de autoplay. El silencio es UNO solo para la música y los efectos:
// la fuente de verdad es lib/sfx.js (que lo guarda en localStorage['rona.muted']) y este store
// sólo lo refleja, así el botón del lobby y el de la mesa nunca se contradicen.
// El <audio> pasa por el AudioContext de sfx.js: <audio> → gain del fundido → musicBus (volumen del usuario).
// Así el volumen funciona también en iOS, donde HTMLMediaElement.volume es de sólo lectura.
const VOLUME = 0.35;

export const useMusicStore = create(() => ({
  muted: isMuted(),
  volume: getVolume('music'),
  toggle: () => toggleMute(),
}));

onMuteChange((muted) => useMusicStore.setState({ muted }));
onVolumeChange((kind, volume) => { if (kind === 'music') useMusicStore.setState({ volume }); });

let audio = null;
let users = 0;
let fadeTimer = null;
let stopTimer = null;
let unlockArmed = false;
// Grafo de WebAudio: null = aún no se intenta, false = no se pudo (se usa audio.volume)
let graph = null;
let fadeLevel = 0; // sólo para el modo de respaldo con audio.volume

const getAudio = () => {
  if (!audio && typeof Audio !== 'undefined') {
    audio = new Audio(soundtrack);
    audio.loop = true;
    audio.preload = 'auto';
    audio.volume = 0;
  }
  return audio;
};

// Conecta el <audio> al AudioContext una sola vez (createMediaElementSource no se puede repetir)
const connectGraph = () => {
  if (graph !== null) return graph;
  const a = getAudio();
  const ctx = getAudioContext();
  const bus = getMusicBus();
  if (!a || !ctx || !bus) { graph = false; return graph; }
  try {
    const src = ctx.createMediaElementSource(a);
    const fade = ctx.createGain();
    fade.gain.value = 0;
    src.connect(fade);
    fade.connect(bus);
    a.volume = 1;
    graph = { ctx, fade };
  } catch (err) {
    console.warn('[música] sin WebAudio, se usa audio.volume', err);
    graph = false;
  }
  return graph;
};

// Volumen efectivo en el modo de respaldo: fundido × volumen del usuario
const applyFallbackVolume = () => {
  const a = getAudio();
  if (!a || graph) return;
  const { muted, volume } = useMusicStore.getState();
  a.volume = Math.max(0, Math.min(1, fadeLevel * (muted ? 0 : volume / 100)));
};

const fadeTo = (target, ms = 900, done) => {
  const a = getAudio();
  if (!a) return;
  clearInterval(fadeTimer);
  clearTimeout(fadeTimer);
  if (graph) {
    const { ctx, fade } = graph;
    const now = ctx.currentTime;
    fade.gain.cancelScheduledValues(now);
    fade.gain.setValueAtTime(fade.gain.value, now);
    fade.gain.linearRampToValueAtTime(target, now + ms / 1000);
    if (done) fadeTimer = setTimeout(done, ms);
    return;
  }
  const steps = 18;
  const from = fadeLevel;
  let i = 0;
  fadeTimer = setInterval(() => {
    i += 1;
    fadeLevel = from + ((target - from) * i) / steps;
    applyFallbackVolume();
    if (i >= steps) {
      clearInterval(fadeTimer);
      done?.();
    }
  }, ms / steps);
};

// Si el navegador bloquea el autoplay, reintenta en la primera interacción
const armUnlock = () => {
  if (unlockArmed) return;
  unlockArmed = true;
  const retry = () => {
    unlockArmed = false;
    window.removeEventListener('pointerdown', retry);
    window.removeEventListener('keydown', retry);
    sync();
  };
  window.addEventListener('pointerdown', retry, { once: true });
  window.addEventListener('keydown', retry, { once: true });
};

const sync = () => {
  const a = getAudio();
  if (!a) return;
  const { muted, volume } = useMusicStore.getState();
  const shouldPlay = users > 0 && !muted && volume > 0;
  applyFallbackVolume();
  if (shouldPlay) {
    clearTimeout(stopTimer);
    getAudioContext()?.resume?.().catch(() => {});
    if (a.paused) {
      connectGraph();
      a.play().then(() => fadeTo(VOLUME)).catch(() => armUnlock());
    } else {
      fadeTo(VOLUME);
    }
  } else if (!a.paused) {
    fadeTo(0, 500, () => a.pause());
  }
};

useMusicStore.subscribe(sync);

// Mientras la pantalla que lo usa esté montada, suena la música
export const useLobbyMusic = () => {
  useEffect(() => {
    users += 1;
    sync();
    return () => {
      users -= 1;
      // Pequeña espera para que el cambio lobby → sala no corte la canción
      clearTimeout(stopTimer);
      stopTimer = setTimeout(sync, 150);
    };
  }, []);
};

// Botón de volumen del lobby y la sala (TopBar lo renderiza con este nombre)
export const MusicToggle = () => <VolumeControl buttonClassName="ui-icon-btn" />;
