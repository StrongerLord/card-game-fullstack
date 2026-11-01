// Registro de efectos visuales compartido entre el reproductor de eventos, las cartas y la capa de partículas.
// - origins: de dónde debe "llegar volando" un elemento que se monta (carta de un rival, carta robada…)
// - emitFx: dispara un efecto de partículas en la capa FxLayer
// - anchors: los elementos marcados con data-anchor="…" sirven de referencia de posición

export const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Anclas de posición ----------

export const anchorEl = (anchor) =>
  typeof document === 'undefined' ? null : document.querySelector(`[data-anchor="${CSS.escape(anchor)}"]`);

export const anchorRect = (anchor) => anchorEl(anchor)?.getBoundingClientRect() || null;

export const centerOf = (r) => (r ? { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height } : null);

// Foto de todas las anclas (para ubicar efectos de cosas que van a desaparecer)
export const snapshotAnchors = () => {
  const map = new Map();
  document.querySelectorAll('[data-anchor]').forEach((el) => map.set(el.dataset.anchor, el.getBoundingClientRect()));
  return map;
};

export const slotAnchor = (playerId, slotId) => `slot:${playerId}:${slotId}`;
export const avatarAnchor = (playerId) => `avatar:${playerId}`;
export const handAnchor = (playerId) => `hand:${playerId}`;

// ---------- Llegadas volando ----------

const origins = new Map(); // key → { x, y, flip, delay, scale, rotate, at }

// Registra que el elemento `key` (al montarse) debe venir desde el punto (x, y) de la pantalla
export const setOrigin = (key, point, opts = {}) => {
  if (!point) return;
  origins.set(key, { x: point.x, y: point.y, at: Date.now(), ...opts });
};

export const hasOrigin = (key) => origins.has(key);

// Parte lineal (rotación y escala) acumulada de los contenedores de `el` hasta .gt-root.
// El translate del vuelo se aplica DENTRO de esos contenedores girados (descarte ±17°, abanico de la
// mano, modificadores ±2.5°): sin corregirlo, la carta arranca girada y "cae del cielo".
const linearToRoot = (el) => {
  let m = new DOMMatrix();
  for (let x = el; x && x.nodeType === 1 && !x.classList.contains('gt-root'); x = x.parentElement) {
    const t = getComputedStyle(x).transform;
    if (t && t !== 'none') {
      const a = new DOMMatrix(t);
      m = new DOMMatrix([a.a, a.b, a.c, a.d, 0, 0]).multiply(m);
    }
  }
  return m;
};

// Ángulo en pantalla (grados) de un elemento, sumando el de sus contenedores
export const screenAngle = (el) => {
  if (!el) return 0;
  const m = linearToRoot(el);
  return (Math.atan2(m.b, m.a) * 180) / Math.PI;
};

// Lo llama cada carta al montarse: si tiene un origen registrado, hace el vuelo con WAAPI
// sobre el contenedor interno (no interfiere con las animaciones de layout de framer-motion).
// Opciones: delay, duration, scale (inicial), midScale, rotate (en pantalla), arc (px hacia arriba a
// medio camino), rise (px que sube antes de viajar), flip (se voltea), flipMs (el volteo termina a
// esos ms; si no, al final), fade (aparece con un fundido; sin distancia, sólo el fundido).
// Devuelve cuánto dura el vuelo (0 si no hubo), para que la carta pase por encima de todo mientras.
export const playOrigin = (key, flyEl, flipEl) => {
  const o = origins.get(key);
  if (!o || !flyEl) return 0;
  origins.delete(key);
  if (Date.now() - o.at > 4000 || reducedMotion()) return 0;
  const r = flyEl.getBoundingClientRect();
  const sx = o.x - (r.left + r.width / 2);
  const sy = o.y - (r.top + r.height / 2);
  const delay = o.delay || 0;
  const duration = o.duration || 620;
  // Sólo un fundido en su sitio (la carta real del descarte tras el tratamiento de un rival)
  if (Math.hypot(sx, sy) < 4 && o.fade) {
    flyEl.animate([{ opacity: 0 }, { opacity: 1 }], { duration, delay, easing: 'ease-out', fill: 'backwards' });
    return 0;
  }
  // Pasar el desplazamiento y el giro de pantalla al sistema local del contenedor
  let m = linearToRoot(flyEl.parentElement);
  if (Math.abs(m.a * m.d - m.b * m.c) < 1e-3) m = new DOMMatrix(); // contenedor aplastado: sin corrección
  const inv = m.inverse();
  const loc = (x, y) => {
    const p = inv.transformPoint(new DOMPoint(x, y));
    return [Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10];
  };
  const base = (Math.atan2(m.b, m.a) * 180) / Math.PI;
  const rot0 = (o.rotate ?? -25) - base;
  const arc = o.arc ?? 40;
  const [dx, dy] = loc(sx, sy);
  const [mx, my] = loc(sx * 0.35, sy * 0.35 - arc);
  const frames = [{ transform: `translate(${dx}px, ${dy}px) scale(${o.scale ?? 0.55}) rotate(${rot0}deg)`, opacity: o.fade ? 0 : 1 }];
  if (o.rise) {
    const [rx, ry] = loc(sx, sy - o.rise);
    frames.push({ transform: `translate(${rx}px, ${ry}px) scale(${o.scale ?? 0.55}) rotate(${rot0 * 0.8}deg)`, opacity: 1, offset: 0.2 });
  }
  frames.push(
    { transform: `translate(${mx}px, ${my}px) scale(${o.midScale ?? 1.12}) rotate(${rot0 / 3}deg)`, opacity: 1, offset: 0.55 },
    { transform: 'none', opacity: 1 },
  );
  flyEl.animate(frames, { duration, delay, easing: o.easing || 'cubic-bezier(.25,.8,.3,1)', fill: 'backwards' });
  if (o.flip && flipEl) {
    const end = o.flipMs ? Math.min(0.9, o.flipMs / duration) : null;
    flipEl.animate(
      end
        ? [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(0deg)', offset: end }, { transform: 'rotateY(0deg)' }]
        : [{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: 0.35 }, { transform: 'rotateY(0deg)' }],
      { duration: end ? duration : duration + 120, delay, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'backwards' },
    );
  }
  return delay + duration;
};

// ---------- Ranuras que "reciben" algo (sus insignias aparecen al aterrizar, no antes) ----------

const arriving = new Map(); // slotId → { delay, at }

export const markArriving = (slotId, delayMs = 450) => arriving.set(slotId, { delay: delayMs, at: Date.now() });

export const takeArriving = (slotId) => {
  const a = arriving.get(slotId);
  if (!a) return null;
  arriving.delete(slotId);
  return Date.now() - a.at > 4000 ? null : a;
};

// ---------- Vuelos por layoutId con su propio ritmo (intercambios: trasplante, ladrón, contagio…) ----------

const flights = new Map(); // cardId → { delay, duration, arc, at }

export const setFlight = (cardId, opts) => flights.set(cardId, { at: Date.now(), ...opts });

// Se consulta al renderizar (puede pasar dos veces) y se consume al montar
export const peekFlight = (cardId) => {
  const f = flights.get(cardId);
  return f && Date.now() - f.at < 4000 ? f : null;
};
export const takeFlight = (cardId) => {
  const f = peekFlight(cardId);
  flights.delete(cardId);
  return f;
};

// Pulso corto de "impacto" sobre un elemento (la ranura que recibe una carta)
export const pulse = (el, amount = 1.06, duration = 160) => {
  if (!el || reducedMotion()) return;
  el.animate([{ transform: 'scale(1)' }, { transform: `scale(${amount})` }, { transform: 'scale(1)' }], { duration, easing: 'ease-out' });
};

// Clase temporal (p. ej. is-aimed sobre lo que va a recibir un tratamiento)
export const flashClass = (el, cls, ms) => {
  if (!el) return;
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
};

// ---------- Temblores ----------

export const shake = (el, strength = 8, duration = 450, rot = 1) => {
  if (!el || reducedMotion()) return;
  const s = strength;
  const r = (deg) => deg * rot;
  el.animate(
    [
      { transform: 'translate(0,0) rotate(0)' },
      { transform: `translate(${-s}px, ${s / 3}px) rotate(${r(-3)}deg)` },
      { transform: `translate(${s}px, ${-s / 3}px) rotate(${r(3)}deg)` },
      { transform: `translate(${-s * 0.8}px, 0) rotate(${r(-2)}deg)` },
      { transform: `translate(${s * 0.6}px, ${s / 4}px) rotate(${r(2)}deg)` },
      { transform: `translate(${-s * 0.3}px, 0) rotate(${r(-1)}deg)` },
      { transform: 'translate(0,0) rotate(0)' },
    ],
    { duration, easing: 'ease-in-out' },
  );
};

// Sacude la pantalla entera (explosiones grandes)
export const shakeScreen = (strength = 6) => shake(document.querySelector('.gt-root'), strength, 380, 0);

// ---------- Capa de partículas ----------

let fxSeq = 0;
const fxSubs = new Set();

export const onFx = (fn) => {
  fxSubs.add(fn);
  return () => fxSubs.delete(fn);
};

// fx = { kind: 'explosion'|'sparkles'|'glint'|'goldWave'|'puff'|'trail'|'flyCard'|'reveal'|'shuffle'|
//   'turnPass'|'stamp'|'crownDrop'|'swapArc', ... }
export const emitFx = (fx) => {
  if (reducedMotion() && fx.kind !== 'reveal') return;
  const item = { id: ++fxSeq, ...fx };
  fxSubs.forEach((fn) => fn(item));
};
