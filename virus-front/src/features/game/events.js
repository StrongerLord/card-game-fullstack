// Reproductor de eventos: saca los lotes { seq, events } de useStore.eventQueue en orden,
// reproduce los efectos (partículas, sonidos, narrador) y aplica el estado a la mesa.
//
// Cada lote se reproduce como una coreografía (ver playBatch): la carta jugada sale de la mano de quien
// juega, toca su objetivo, y recién entonces explota, se cura o se infecta; lo gastado vuela al descarte,
// los robos llegan a las manos y al final el turno pasa al siguiente. Entre paso y paso se aplican vistas
// intermedias del estado, así nada aparece ni desaparece de golpe.

import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { sfx } from '../../lib/sfx';
import { COLOR_HEX, cardLabel } from '../../lib/cards';
import {
  anchorRect, avatarAnchor, centerOf, emitFx, handAnchor, setOrigin, shake, shakeScreen, anchorEl, slotAnchor, wait, reducedMotion,
  screenAngle, markArriving, setFlight, pulse, flashClass,
} from './fx';
import { hideBanner, narrate, showBanner } from './Overlays';

const ORGAN_NAME = { red: 'corazón', green: 'estómago', blue: 'cerebro', yellow: 'hueso', multi: 'órgano comodín' };
const ORGAN_ART = { red: 'un corazón', green: 'un estómago', blue: 'un cerebro', yellow: 'un hueso', multi: 'el órgano comodín' };

// ---------- Narración ----------

const findSlot = (views, slotId) => {
  for (const v of views) {
    for (const p of v?.players || []) {
      const s = p.body?.find((b) => b.id === slotId);
      if (s) return s;
    }
  }
  return null;
};

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Convierte un lote de eventos en frases ("Vane le robó el corazón a Elian")
export const describeBatch = (events, { me, prev, next }) => {
  const views = [prev, next];
  const nameOf = (pid) => next?.players?.find((p) => p.id === pid)?.name || prev?.players?.find((p) => p.id === pid)?.name || 'Alguien';
  const colorOfSlot = (slotId, cards) => {
    const organ = cards?.find((c) => c.kind === 'organ') || findSlot(views, slotId)?.organ;
    return organ?.color;
  };
  const organ = (slotId, cards) => ORGAN_NAME[colorOfSlot(slotId, cards)] || 'órgano';
  const theOrgan = (slotId, pid, cards) => (pid === me ? `tu ${organ(slotId, cards)}` : `el ${organ(slotId, cards)} de ${nameOf(pid)}`);

  const lines = [];
  let actor = null;
  let played = null;
  let narratedPlay = false;
  const moved = [];
  const skipped = [];
  const contagion = { from: null, to: [] };

  const push = (text, opts = {}) => lines.push({ text, ...opts });

  for (const e of events) {
    switch (e.type) {
      case 'played':
        actor = e.playerId;
        played = e.card;
        narratedPlay = false;
        break;
      case 'organPlaced':
        push(e.playerId === me ? `Te pusiste ${ORGAN_ART[colorOfSlot(e.slotId)] || 'un órgano'}` : `${nameOf(e.playerId)} se puso ${ORGAN_ART[colorOfSlot(e.slotId)] || 'un órgano'}`, { pid: e.playerId });
        narratedPlay = true;
        break;
      case 'infected': {
        const a = actor ?? e.playerId;
        const o = organ(e.slotId);
        let t;
        if (a === e.playerId) t = a === me ? `Te infectaste tu propio ${o}` : `${nameOf(a)} se infectó su propio ${o}`;
        else if (a === me) t = `Le pegaste roña al ${o} de ${nameOf(e.playerId)}`;
        else if (e.playerId === me) t = `${nameOf(a)} te pegó roña en el ${o}`;
        else t = `${nameOf(a)} le pegó roña al ${o} de ${nameOf(e.playerId)}`;
        push(t, { pid: a, tone: e.playerId === me ? 'bad' : 'info' });
        narratedPlay = true;
        break;
      }
      case 'organDestroyed': {
        const a = actor ?? e.playerId;
        const o = organ(e.slotId, e.cards);
        let t;
        if (a === me && e.playerId !== me) t = `¡Destruiste el ${o} de ${nameOf(e.playerId)}!`;
        else if (e.playerId === me && a !== me) t = `¡${nameOf(a)} te destruyó el ${o}!`;
        else if (a === e.playerId) t = a === me ? `Destruiste tu propio ${o}` : `${nameOf(a)} destruyó su propio ${o}`;
        else t = `¡${nameOf(a)} destruyó el ${o} de ${nameOf(e.playerId)}!`;
        push(t, { pid: a, tone: e.playerId === me ? 'bad' : 'hot' });
        narratedPlay = true;
        break;
      }
      case 'cured':
        push(e.playerId === me ? `Te curaste el ${organ(e.slotId)}` : `${nameOf(e.playerId)} se curó el ${organ(e.slotId)}`, { pid: e.playerId, tone: 'good' });
        narratedPlay = true;
        break;
      case 'vaccinated':
        push(e.playerId === me ? `Vacunaste tu ${organ(e.slotId)}` : `${nameOf(e.playerId)} vacunó su ${organ(e.slotId)}`, { pid: e.playerId, tone: 'good' });
        narratedPlay = true;
        break;
      case 'immunized':
        push(e.playerId === me ? `¡Inmunizaste tu ${organ(e.slotId)}!` : `¡${nameOf(e.playerId)} inmunizó su ${organ(e.slotId)}!`, { pid: e.playerId, tone: 'gold' });
        narratedPlay = true;
        break;
      case 'vaccineRemoved': {
        const a = actor ?? e.playerId;
        const t = a === me
          ? `Le quitaste la vacuna del ${organ(e.slotId)} a ${nameOf(e.playerId)}`
          : e.playerId === me
            ? `${nameOf(a)} te quitó la vacuna del ${organ(e.slotId)}`
            : `${nameOf(a)} le quitó la vacuna del ${organ(e.slotId)} a ${nameOf(e.playerId)}`;
        push(t, { pid: a });
        narratedPlay = true;
        break;
      }
      case 'slotMoved':
        moved.push(e);
        if (played?.treatment === 'thief') {
          const a = actor ?? e.toPlayerId;
          const t = a === me
            ? `Le robaste el ${organ(e.slotId)} a ${nameOf(e.fromPlayerId)}`
            : e.fromPlayerId === me
              ? `¡${nameOf(a)} te robó el ${organ(e.slotId)}!`
              : `${nameOf(a)} le robó el ${organ(e.slotId)} a ${nameOf(e.fromPlayerId)}`;
          push(t, { pid: a, tone: e.fromPlayerId === me ? 'bad' : 'hot' });
          narratedPlay = true;
        } else if (moved.length === 2) {
          const [x, y] = moved;
          const what = `${theOrgan(x.slotId, x.fromPlayerId)} por ${theOrgan(y.slotId, y.fromPlayerId)}`;
          push(actor === me ? `Trasplante: ${what}` : `${nameOf(actor)} hizo un trasplante: ${what}`, { pid: actor, tone: x.fromPlayerId === me || y.fromPlayerId === me ? 'bad' : 'info' });
          narratedPlay = true;
        }
        break;
      case 'virusMoved':
        contagion.from = e.fromPlayerId;
        contagion.to.push(e.toPlayerId);
        break;
      case 'handsDiscarded':
        push(actor === me ? '¡Usaste el guante! Todos tiran su mano y pierden un turno' : `¡${nameOf(actor)} usó el guante! Todos tiran su mano`, { pid: actor, tone: 'hot' });
        narratedPlay = true;
        break;
      case 'bodiesSwapped': {
        // e.a es quien jugó el error médico; e.b, a quien se lo hizo
        if (e.a === me) push(`¡Error médico! Cambiaste tu cuerpo con el de ${nameOf(e.b)}`, { pid: e.a, tone: 'hot' });
        else if (e.b === me) push(`¡${nameOf(e.a)} te cambió el cuerpo!`, { pid: e.a, tone: 'bad' });
        else push(`¡${nameOf(e.a)} cambió su cuerpo con el de ${nameOf(e.b)}!`, { pid: e.a, tone: 'hot' });
        narratedPlay = true;
        break;
      }
      case 'discarded':
        push(e.playerId === me ? `Descartaste ${plural(e.count, 'carta', 'cartas')}` : `${nameOf(e.playerId)} descartó ${plural(e.count, 'carta', 'cartas')}`, { pid: e.playerId, tone: 'muted' });
        break;
      case 'reshuffled':
        push(`Se barajó el descarte: el mazo vuelve a tener ${e.count}`, { tone: 'muted' });
        break;
      case 'turnSkipped':
        // Se agrupan al final en una sola línea ("Adán, Elian y tú pierden turno")
        skipped.push(e.playerId);
        break;
      case 'timeout':
        push(e.playerId === me ? 'Se te acabó el tiempo: se descartó una carta' : `${nameOf(e.playerId)} se tardó demasiado`, { pid: e.playerId, tone: 'muted' });
        break;
      case 'playerLeft':
        push(`${nameOf(e.playerId)} abandonó la partida`, { pid: e.playerId, tone: 'bad' });
        break;
      case 'win':
        push(e.playerId === me ? '¡Ganaste la partida!' : `¡${nameOf(e.playerId)} ganó la partida!`, { pid: e.playerId, tone: 'gold' });
        break;
      default:
        break;
    }
  }

  if (contagion.to.length) {
    const others = [...new Set(contagion.to)].filter((p) => p !== me).map(nameOf);
    const hitMe = contagion.to.includes(me);
    const from = contagion.from;
    let t;
    if (from === me) t = `Contagiaste a ${others.join(' y ')}`;
    else if (hitMe) t = `¡${nameOf(from)} te contagió${others.length ? ` (y a ${others.join(' y ')})` : ''}!`;
    else t = `${nameOf(from)} contagió a ${others.join(' y ')}`;
    lines.unshift({ text: t, pid: from, tone: hitMe ? 'bad' : 'hot' });
    narratedPlay = true;
  }
  // Una carta jugada sin consecuencias visibles (p. ej. un contagio que no movió nada)
  if (played && !narratedPlay) {
    lines.unshift({ text: actor === me ? `Jugaste ${cardLabel(played)}` : `${nameOf(actor)} jugó ${cardLabel(played)}`, pid: actor });
  }
  if (skipped.length) {
    const others = skipped.filter((p) => p !== me).map(nameOf);
    const all = skipped.includes(me) ? [...others, 'tú'] : others;
    let t;
    if (all.length === 1) t = skipped[0] === me ? 'Pierdes este turno (te tocó el guante)' : `${all[0]} pierde su turno`;
    else t = `${all.slice(0, -1).join(', ')} y ${all[all.length - 1]} pierden turno`;
    push(t, { pid: skipped[0], tone: skipped.includes(me) ? 'bad' : 'muted' });
  }
  return lines;
};

// ---------- Utilidades de posición ----------

const cardRects = () => {
  const map = new Map();
  document.querySelectorAll('[data-card-id]').forEach((el) => map.set(el.dataset.cardId, el.getBoundingClientRect()));
  return map;
};

const visibleCards = (view) => {
  const map = new Map();
  if (!view) return map;
  (view.hand || []).forEach((c) => map.set(c.id, c));
  (view.players || []).forEach((p) => p.body?.forEach((s) => {
    map.set(s.organ.id, s.organ);
    s.viruses?.forEach((c) => map.set(c.id, c));
    s.medicines?.forEach((c) => map.set(c.id, c));
  }));
  if (view.discardTop) map.set(view.discardTop.id, view.discardTop);
  return map;
};

const slotCenter = (playerId, slotId) => centerOf(anchorRect(slotAnchor(playerId, slotId)));

const pidColor = (room, pid) => room?.players?.find((p) => p.id === pid)?.color;

const cardEl = (id) => document.querySelector(`[data-card-id="${CSS.escape(id)}"]`);

// Un punto dentro de la ventana (las manos de los rivales asoman cortadas por el borde)
const clampIn = (p, m = 24) => p && ({
  ...p,
  x: Math.min(window.innerWidth - m, Math.max(m, p.x)),
  y: Math.min(window.innerHeight - m, Math.max(m, p.y)),
});

// Ángulo en (-90, 90]: un reverso al revés se ve igual que derecho
const uprightAngle = (deg) => {
  let a = ((deg % 360) + 540) % 360 - 180;
  if (a > 90) a -= 180;
  if (a <= -90) a += 180;
  return a;
};

// Diferencia de ángulos por el camino corto (para que nada dé la vuelta completa)
const shortTurn = (from, to) => from + ((((to - from) % 360) + 540) % 360) - 180;

// De dónde sale la carta de un rival: el reverso que levantó al pensar, el del centro de su abanico,
// su contador o, como último recurso, su avatar. Nunca el avatar si hay algo mejor.
const rivalHandPoint = (pid, count) => {
  const hand = anchorEl(handAnchor(pid));
  const lifted = hand?.querySelector('[data-lift]');
  const back = lifted?.querySelector('.gc')
    || lifted
    || document.querySelector(`[data-fx-key="${CSS.escape(`${pid}:b${Math.floor(Math.min(count, 7) / 2)}`)}"]`);
  const el = back || hand;
  if (el) {
    const c = centerOf(el.getBoundingClientRect());
    return { ...clampIn(c), angle: back ? uprightAngle(screenAngle(back)) : 0 };
  }
  return { ...(centerOf(anchorRect(avatarAnchor(pid))) || { x: window.innerWidth / 2, y: 0 }), angle: 0 };
};

// A dónde llega una carta robada por un rival: el reverso más cercano al mazo, dentro de la ventana
const rivalDrawPoint = (pid, deckC) => {
  const hand = anchorEl(handAnchor(pid));
  const backs = hand ? [...hand.querySelectorAll('.gc')] : [];
  let best = null;
  let bestD = Infinity;
  for (const b of backs) {
    const c = centerOf(b.getBoundingClientRect());
    const d = deckC ? Math.hypot(c.x - deckC.x, c.y - deckC.y) : 0;
    if (d < bestD) { best = c; bestD = d; }
  }
  return clampIn(best || centerOf(hand?.getBoundingClientRect()) || centerOf(anchorRect(avatarAnchor(pid))));
};

// Vuelo de la carta de un rival: sube un poco, se voltea en los primeros 200 ms y viaja casi a tamaño real
const RIVAL_FLY = { flip: true, flipMs: 200, scale: 0.9, midScale: 1, arc: 30, rise: 30, duration: 630 };

// Carta que golpea la ranura objetivo (vista intermedia del acercamiento): se pinta encima del órgano
const stackOn = (body, slotId, card) => body.map((s) => (s.id === slotId ? { ...s, incoming: card } : s));

// ---------- Estado de cada lote ----------

// El servidor manda game:events y justo después el game:state que le corresponde. useStore sólo guarda
// el último estado, así que aquí se empareja cada estado con el lote que lo trajo: si se acumulan
// varios lotes, cada uno se anima con SU estado y no con el más nuevo.
const batchStates = new WeakMap();
useStore.subscribe((s, prevS) => {
  if (!s.game || s.game === prevS.game) return;
  const last = s.eventQueue[s.eventQueue.length - 1];
  if (last && !batchStates.has(last)) batchStates.set(last, s.game);
});

// ---------- Hook principal ----------

// Lo mínimo que se ve el turno de un bot antes de su jugada (globo de "pensando" incluido)
const BOT_MIN_VISIBLE_MS = 1300;

// Si el lote es la jugada del bot que tiene el turno en la vista, su id (si no, null)
const botActor = (batch, view) => {
  const e = batch?.events?.find((x) => x.type === 'played' || x.type === 'discarded' || x.type === 'timeout');
  if (!e || e.type === 'timeout' || !view || view.turnPlayerId !== e.playerId) return null;
  const info = useStore.getState().room?.players?.find((p) => p.id === e.playerId);
  return info?.isBot ? e.playerId : null;
};

// Devuelve el PlayerView que se está mostrando (va detrás del de useStore mientras se animan los eventos).
// Mientras se anima un lote, la vista es intermedia (view.animating = true) y conserva el turno viejo.
export const useEventPlayer = ({ me }) => {
  const storeGame = useStore((s) => s.game);
  const queue = useStore((s) => s.eventQueue);
  const [view, setView] = useState(storeGame);
  const viewRef = useRef(view);
  viewRef.current = view;
  const busy = useRef(false);
  const alive = useRef(true);
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => () => { alive.current = false; }, []);

  // Sin eventos pendientes, el estado se aplica directo
  useEffect(() => {
    if (!busy.current && queue.length === 0 && storeGame !== viewRef.current) setView(storeGame);
  }, [storeGame, queue.length]);

  // Partida nueva (revancha): quitar el oscurecido de la victoria
  const hasWinner = !!view?.winner;
  useEffect(() => {
    if (hasWinner) return;
    const root = document.querySelector('.gt-root');
    root?.classList.remove('is-win-dim');
    document.querySelectorAll('.gt-root .is-winner').forEach((el) => el.classList.remove('is-winner'));
  }, [hasWinner]);

  // Cuándo se vio por última vez que empezó un turno (para que la jugada de un bot no llegue de golpe)
  const turnKey = view ? `${view.turnNumber}:${view.turnPlayerId}` : '';
  const turnShownAt = useRef(0);
  useEffect(() => {
    if (!view?.animating) turnShownAt.current = Date.now();
  }, [turnKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (busy.current || queue.length === 0) return;
    busy.current = true;
    const batch = queue[0];
    // Cola atrasada (p. ej. tras un corte): se reproduce en modo rápido para alcanzar al servidor
    const speed = queue.length > 1 ? 0.35 : 1;
    // Red de seguridad: si el servidor calculó corto y la jugada del bot llega casi junto con su turno,
    // se retiene hasta que alcance a verse que está pensando (el globo sale a los 800 ms)
    const hold = speed < 1 ? 0 : Math.max(0, BOT_MIN_VISIBLE_MS - (Date.now() - turnShownAt.current));
    const actor = botActor(batch, viewRef.current);
    (hold && actor ? wait(hold) : Promise.resolve())
      .then(() => (alive.current ? playBatch(batch, { me: meRef.current, viewRef, setView, alive, speed }) : null))
      .catch((err) => console.error('[mesa] error al animar eventos', err))
      .finally(() => {
        busy.current = false;
        if (!alive.current) return;
        useStore.getState().shiftEvents();
        // Si ya no quedan lotes, aplicar el último estado
        if (useStore.getState().eventQueue.length === 0) setView(useStore.getState().game);
      });
  }, [queue]);

  return view;
};

// Consecuencias que mandan cartas del slot al descarte: la carta jugada primero toca su objetivo
const HITS = new Set(['organDestroyed', 'cured', 'vaccineRemoved']);
// Ranuras cuyo estado (insignia, aura) cambia al aterrizar la carta
const STATE_CHANGES = new Set(['infected', 'cured', 'vaccinated', 'immunized', 'organPlaced']);

// Reproduce un lote. Secuencia:
//   0. Avisos previos: se acabó el tiempo, tratamiento de un rival en grande (vuela al descarte al final).
//   A. Acercamiento: la carta jugada vuela a su objetivo y lo golpea; ahí la explosión o los destellos.
//   B. Aterrizaje: el estado nuevo (con el turno viejo); lo gastado vuela al descarte en el mismo frame.
//      Los efectos de cada ranura salen cuando la carta llega (LAND), no antes.
//   C. Lo que sigue en orden: rebarajeo, robos, turnos perdidos (sello) y sus robos.
//   D. El turno pasa (ficha del color del jugador de un avatar al otro) y se aplica el estado final.
const playBatch = async (batch, { me, viewRef, setView, alive, speed = 1 }) => {
  const events = batch?.events || [];
  const prev = viewRef.current;
  const room = useStore.getState().room;
  const fast = reducedMotion();
  const quick = speed < 1;
  const T = (ms) => (fast ? 0 : Math.round(ms * speed));
  const sleep = async (ms) => {
    const t = T(ms);
    if (t > 0) await wait(t);
    return alive.current;
  };
  const later = (ms, fn) => setTimeout(() => alive.current && fn(), T(ms));

  if (events.some((e) => e.type === 'played' || e.type === 'win')) hideBanner();

  // 1. Fotos del estado viejo
  const oldRects = cardRects();
  const deckC = centerOf(anchorRect('deck'));
  const discardC = centerOf(anchorRect('discard'));
  const knownCards = visibleCards(prev);

  // Dejar que llegue el game:state que acompaña al lote (el servidor lo manda justo después)
  await wait(40);
  if (!alive.current) return;
  const next = batchStates.get(batch) || useStore.getState().game;
  if (!next) return;
  if (!prev || fast) {
    // Sin animaciones: estado directo, con sus avisos
    setView(next);
    describeBatch(events, { me, prev, next }).forEach((l) => narrate(l.text, { tone: l.tone, color: pidColor(room, l.pid) }));
    if (next.turnPlayerId === me && !next.winner && (prev?.turnPlayerId !== me || prev?.turnNumber !== next.turnNumber)) showBanner('¡Tu turno!');
    return;
  }
  const nameOf = (pid) => next.players?.find((p) => p.id === pid)?.name || prev.players?.find((p) => p.id === pid)?.name || '';

  // Narración: en el primer impacto (fin del acercamiento o aterrizaje), no antes
  const lines = describeBatch(events, { me, prev, next });
  let narrated = false;
  const narrateNow = () => {
    if (narrated) return;
    narrated = true;
    lines.forEach((l) => narrate(l.text, { tone: l.tone, color: pidColor(room, l.pid) }));
  };

  const playedIdx = events.findIndex((e) => e.type === 'played');
  const played = events[playedIdx];
  const actor = played?.playerId;
  const card = played?.card;
  const rival = !!played && actor !== me;
  const conseq = played ? events[playedIdx + 1] : null;
  const timeoutEv = events.find((e) => e.type === 'timeout');
  const winEv = events.find((e) => e.type === 'win');
  const glove = events.find((e) => e.type === 'handsDiscarded');
  const skippedIds = new Set(events.filter((e) => e.type === 'turnSkipped').map((e) => e.playerId));

  // ---------- Vista mostrada: se arma por partes ----------
  // Arranca igual que la vieja y avanza paso a paso; el turno sólo pasa al final del lote.
  const S = {
    bodies: new Map((prev.players || []).map((p) => [p.id, p.body])),
    hand: prev.hand || [],
    counts: new Map((prev.players || []).map((p) => [p.id, p.handCount])),
    deckCount: prev.deckCount,
    discardTop: prev.discardTop,
    discardCount: prev.discardCount,
    turnPid: prev.turnPlayerId,
    turnNumber: prev.turnNumber,
    turnDeadline: prev.turnDeadline,
    skip: new Set([...skippedIds]),
    winner: prev.winner || null,
    acting: actor || timeoutEv?.playerId || null,
  };
  const compose = () => ({
    ...next,
    animating: true,
    hand: S.hand,
    deckCount: S.deckCount,
    discardTop: S.discardTop,
    discardCount: S.discardCount,
    turnPlayerId: S.turnPid,
    turnNumber: S.turnNumber,
    turnDeadline: S.turnDeadline,
    winner: S.winner,
    players: (next.players || []).map((p) => ({
      ...p,
      body: S.bodies?.get(p.id) ?? p.body,
      handCount: S.counts.get(p.id) ?? p.handCount,
      isTurn: !S.winner && p.id === S.turnPid,
      skipNext: S.skip.has(p.id) ? true : p.skipNext,
      acting: p.id === S.acting,
    })),
  });
  const show = () => setView(compose());
  const countOf = (pid) => S.counts.get(pid) ?? 0;

  const stampOn = (pid, opts) => {
    const a = centerOf(anchorRect(avatarAnchor(pid)));
    if (a) emitFx({ kind: 'stamp', x: a.x, y: a.y - (a.h || 0) * 0.1, ...opts });
  };

  // ---------- 0. Avisos previos ----------

  if (timeoutEv) {
    if (timeoutEv.playerId === me) {
      showBanner('¡Se acabó el tiempo!', { ms: 1200 });
      shake(anchorEl('hand:me'), 6, 300);
    } else {
      stampOn(timeoutEv.playerId, { clock: true, duration: 600 });
    }
    if (!(await sleep(400))) return;
  }

  // Tratamiento de un rival: la carta en grande al centro y, mientras, se señala a quién le va a tocar
  let revealed = false;
  if (rival && card?.kind === 'treatment') {
    const from = rivalHandPoint(actor, countOf(actor));
    S.counts.set(actor, Math.max(0, countOf(actor) - 1));
    sfx.play();
    if (!quick) {
      const dr = anchorRect('discard');
      emitFx({ kind: 'reveal', card, who: nameOf(actor), to: discardC, toW: dr?.width, duration: 950 });
      show();
      aimTargets(events.slice(playedIdx + 1), me);
      if (!(await sleep(900))) return;
      revealed = true;
      // La carta real del descarte aparece con un fundido justo cuando la grande llega
      setOrigin(card.id, discardC, { fade: true, duration: 150 });
    } else {
      setOrigin(card.id, from, { ...RIVAL_FLY, rotate: from.angle });
    }
  }

  // ---------- A. Acercamiento: la carta toca su objetivo ----------

  let land = 0; // ms desde el aterrizaje hasta que todo llegó
  const origin = (key, point, opts) => {
    setOrigin(key, point, opts);
    land = Math.max(land, (opts.delay || 0) + (opts.duration || 620));
  };

  let impacted = false;
  let approached = false;
  if (played && card && card.kind !== 'treatment' && conseq && HITS.has(conseq.type)) {
    const slotEl = anchorEl(slotAnchor(conseq.playerId, conseq.slotId));
    const organRect = oldRects.get(conseq.slotId);
    const from = oldRects.get(card.id);
    // Con arrastre la carta ya está encima del objetivo: no hace falta acercarla
    const over = from && organRect && Math.hypot(
      from.left + from.width / 2 - (organRect.left + organRect.width / 2),
      from.top + from.height / 2 - (organRect.top + organRect.height / 2),
    ) < 40;
    if (!quick && !over) {
      if (rival) {
        const p = rivalHandPoint(actor, countOf(actor));
        setOrigin(card.id, p, { ...RIVAL_FLY, rotate: p.angle });
        S.counts.set(actor, Math.max(0, countOf(actor) - 1));
        sfx.play();
      } else {
        S.hand = S.hand.filter((c) => c.id !== card.id);
      }
      const owner = conseq.playerId;
      S.bodies.set(owner, stackOn(S.bodies.get(owner) || [], conseq.slotId, card));
      show();
      approached = true;
      if (!(await sleep(rival ? RIVAL_FLY.duration - 60 : 550))) return;
    }
    // Impacto: la ranura acusa el golpe
    if (!quick) {
      pulse(slotEl, 1.06, 160);
      if (!(await sleep(120))) return;
    }
    impacted = true;
    narrateNow();
    const c = centerOf(slotEl?.getBoundingClientRect());
    if (conseq.type === 'organDestroyed') {
      shake(slotEl, 10, 420);
      const color = COLOR_HEX[conseq.cards?.find((x) => x.kind === 'organ')?.color] || '#ff4d4d';
      if (c) emitFx({ kind: 'explosion', x: c.x, y: c.y, w: c.w || 80, color });
      shakeScreen(5);
      sfx.destroy();
      if (!(await sleep(280))) return;
    } else if (conseq.type === 'cured') {
      if (c) emitFx({ kind: 'sparkles', x: c.x, y: c.y, w: c.w });
      sfx.cure();
      if (!(await sleep(160))) return;
    } else {
      if (c) emitFx({ kind: 'puff', x: c.x, y: c.y, w: c.w });
      sfx.infect();
      if (!(await sleep(160))) return;
    }
  }

  // ---------- B. Aterrizaje ----------

  // Lo que viene después del lote se reproduce en orden (robos, turnos…); aquí sólo la jugada
  const prevHandIds = new Set((prev.hand || []).map((c) => c.id));
  S.bodies = null; // cuerpos del estado nuevo
  // Las que salieron de mi mano en este lote no vuelven aunque las robe otra vez tras un rebarajeo
  const leftHand = new Set();
  events.forEach((e) => {
    if (e.playerId !== me) return;
    if (e.type === 'played') leftHand.add(e.card.id);
    if (e.type === 'discarded') e.cards?.forEach((c) => leftHand.add(c.id));
  });
  if (glove?.playerIds.includes(me)) prevHandIds.forEach((id) => leftHand.add(id));
  S.hand = (next.hand || []).filter((c) => prevHandIds.has(c.id) && !leftHand.has(c.id) && S.hand.some((h) => h.id === c.id));
  const reshuffleAt = events.findIndex((e) => e.type === 'reshuffled');
  if (reshuffleAt < 0) {
    S.discardTop = next.discardTop;
    S.discardCount = next.discardCount;
  } else {
    // Antes del rebarajeo el descarte tiene encima la última carta que cayó en este lote
    const lastIn = [...events.slice(0, reshuffleAt)].reverse().map((e) => {
      if (e.type === 'organDestroyed') return e.cards?.[e.cards.length - 1];
      if (e.type === 'discarded') return e.cards?.[e.cards.length - 1];
      if (e.type === 'played' && (e.card.kind === 'treatment' || HITS.has(events[events.indexOf(e) + 1]?.type))) return e.card;
      return null;
    }).find(Boolean);
    S.discardTop = lastIn || prev.discardTop;
    S.discardCount = Math.max(1, (prev.discardCount || 0) + (lastIn ? 1 : 0));
  }
  if (winEv) S.winner = next.winner;

  // Carta del rival que no pasó por el acercamiento (órgano, vacuna, contagio sin descarte…)
  if (rival && card && card.kind !== 'treatment' && !approached) {
    const p = rivalHandPoint(actor, countOf(actor));
    origin(card.id, p, { ...RIVAL_FLY, rotate: p.angle });
    S.counts.set(actor, Math.max(0, countOf(actor) - 1));
    sfx.play();
  }
  if (played && !rival) land = Math.max(land, 560); // mi carta vuela por su layoutId
  if (revealed) land = Math.max(land, 150);

  // Descartes de un rival (también el de un timeout): salen de su mano
  const flies = [];
  for (const e of events) {
    if (e.type !== 'discarded' || !e.cards?.length) continue;
    if (e.playerId === me) { land = Math.max(land, 560); continue; }
    const p = rivalHandPoint(e.playerId, countOf(e.playerId));
    const last = e.cards[e.cards.length - 1];
    origin(last.id, p, { ...RIVAL_FLY, rotate: p.angle, delay: (e.cards.length - 1) * 70 });
    e.cards.slice(0, -1).forEach((c, i) => {
      flies.push({ kind: 'flyCard', from: p, to: discardC, w: 60, h: 75, card: c, delay: i * 70, rotate: p.angle, duration: 600 });
      land = Math.max(land, i * 70 + 600);
    });
    S.counts.set(e.playerId, Math.max(0, countOf(e.playerId) - e.count));
  }

  // Guante: todas las manos salen a la vez al descarte, en abanico
  if (glove) {
    let k = 0;
    for (const pid of glove.playerIds) {
      if (pid === me) continue;
      const hand = anchorEl(handAnchor(pid));
      const backs = hand ? [...hand.querySelectorAll('.gc')] : [];
      const pts = backs.length
        ? backs.map((b) => ({ ...clampIn(centerOf(b.getBoundingClientRect())), angle: screenAngle(b), w: b.offsetWidth, h: b.offsetHeight }))
        : Array.from({ length: Math.min(3, countOf(pid)) }, () => ({ ...rivalHandPoint(pid, 3), w: 60, h: 75 }));
      pts.forEach((p) => {
        flies.push({
          kind: 'flyCard', from: p, to: discardC, w: p.w || 60, h: p.h || 75, faceDown: true, delay: k * 60, rotate: p.angle || 0, toRotate: shortTurn(p.angle || 0, (k % 2 ? -1 : 1) * 12), duration: 500,
        });
        land = Math.max(land, k * 60 + 500);
        k += 1;
      });
      S.counts.set(pid, 0);
    }
    sfx.swap();
  }

  // Intercambios: cada carta vuela con su propio ritmo y arco (trasplante, ladrón, error médico, contagio)
  // Si la carta no estaba medida (p. ej. se volvió a montar), el vuelo sale de la ranura de origen
  const flightOf = (id, delay, sign, fromPid, fromSlotId) => {
    const r = oldRects.get(id) || anchorRect(slotAnchor(fromPid, fromSlotId)) || null;
    return { delay, sign, r };
  };
  const pendingFlights = [];
  let swapSide = 1;
  events.forEach((e) => {
    if (e.type === 'slotMoved') {
      const slot = findSlotIn(prev, e.fromPlayerId, e.slotId);
      const idx = Math.max(0, (prev.players.find((p) => p.id === e.fromPlayerId)?.body || []).findIndex((s) => s.id === e.slotId));
      if (slot) slotCards(slot).forEach((c) => pendingFlights.push({ ...flightOf(c.id, idx * 60, swapSide, e.fromPlayerId, e.slotId), id: c.id, pid: e.toPlayerId, slotId: e.slotId }));
      swapSide = -swapSide;
    }
    if (e.type === 'bodiesSwapped') {
      [[e.a, e.b, 1], [e.b, e.a, -1]].forEach(([fromPid, toPid, sign]) => {
        (prev.players.find((p) => p.id === fromPid)?.body || []).forEach((slot, i) => {
          slotCards(slot).forEach((c) => pendingFlights.push({ ...flightOf(c.id, i * 60, sign, fromPid, slot.id), id: c.id, pid: toPid, slotId: slot.id }));
        });
      });
    }
  });
  let vm = 0;
  const virusFlights = [];
  events.forEach((e) => {
    if (e.type !== 'virusMoved') return;
    const id = findVirusId(prev, e.fromPlayerId, e.fromSlotId, virusFlights.map((v) => v.id));
    if (id) {
      const f = { ...flightOf(id, vm * 180, vm % 2 ? -1 : 1, e.fromPlayerId, e.fromSlotId), id, pid: e.toPlayerId, slotId: e.toSlotId, e };
      pendingFlights.push(f);
      virusFlights.push(f);
    }
    vm += 1;
  });

  // Aterrizaje visible: estado nuevo con el turno viejo. Marcas y vuelos ANTES de pintarlo.
  const landView = compose();
  for (const f of pendingFlights) {
    const toR = (landView.players.find((p) => p.id === f.pid)?.body || []).some((s) => s.id === f.slotId)
      ? anchorRect(slotAnchor(f.pid, f.slotId)) || anchorRect(`body:${f.pid}`)
      : anchorRect(`body:${f.pid}`);
    const dist = f.r && toR ? Math.hypot(f.r.left - toR.left, f.r.top - toR.top) : 400;
    const duration = Math.round(600 + Math.min(150, dist / 6));
    f.duration = duration;
    setFlight(f.id, { delay: quick ? 0 : f.delay, duration: quick ? 450 : duration, arc: 50 * f.sign });
    land = Math.max(land, (quick ? 0 : f.delay) + (quick ? 450 : duration));
  }
  // Insignias y auras: aparecen cuando su carta llega
  const arriveAt = Math.max(450, Math.min(land || 560, 700));
  events.forEach((e) => {
    if (STATE_CHANGES.has(e.type) && !(impacted && e === conseq)) markArriving(e.slotId, arriveAt);
  });
  pendingFlights.forEach((f) => markArriving(f.slotId, (quick ? 0 : f.delay) + (f.duration || 600) - 80));

  // Lo que desaparece vuela al descarte en el mismo frame en que se quita (sin cuadros vacíos)
  const after = visibleCards(landView);
  const discardEl = document.querySelector('.gt-discard-top');
  const discardAngle = discardEl ? screenAngle(discardEl) : 0;
  const discardW = anchorRect('discard')?.width || 0;
  let k = 0;
  for (const [id] of cardRects()) {
    if (after.has(id) || id === S.discardTop?.id || id === prev.discardTop?.id) continue;
    const c = knownCards.get(id) || (id === card?.id ? card : null);
    const el = cardEl(id);
    if (!c || !el) continue;
    const r = (el.querySelector('.gc-fly') || el).getBoundingClientRect();
    const w = el.offsetWidth || r.width;
    const h = el.offsetHeight || r.height;
    const ang = screenAngle(el);
    flies.push({
      kind: 'flyCard',
      from: centerOf(r),
      to: discardC,
      w,
      h,
      card: c,
      delay: k * 70,
      rotate: ang,
      toRotate: shortTurn(ang, discardAngle + (k % 2 ? -10 : 10)),
      toScale: discardW && w ? discardW / w : 1,
      duration: 500,
    });
    land = Math.max(land, k * 70 + 500);
    k += 1;
  }

  // La carta que queda arriba del descarte (vuela sola por su layoutId) llega al último, encima de las demás
  const top = landView.discardTop;
  const toDiscard = flies.filter((f) => f.to === discardC).length;
  if (top && toDiscard && cardEl(top.id) && top.id !== prev.discardTop?.id) {
    const delay = quick ? 0 : Math.min(240, toDiscard * 70);
    setFlight(top.id, { delay, duration: 520, arc: 0 });
    land = Math.max(land, delay + 520);
  }

  setView(landView);
  flies.forEach((f) => emitFx(f));
  if (!quick) rescueFlights(pendingFlights);

  // Estelas que acompañan a los vuelos (salen junto con las cartas)
  events.forEach((e) => {
    if (e.type === 'bodiesSwapped') {
      const a = centerOf(anchorRect(`body:${e.a}`));
      const b = centerOf(anchorRect(`body:${e.b}`));
      if (a && b) emitFx({ kind: 'swapArc', from: a, to: b, colorA: pidColor(room, e.a), colorB: pidColor(room, e.b), duration: 700 });
      sfx.swap();
    }
    if (e.type === 'slotMoved' && e === events.find((x) => x.type === 'slotMoved')) sfx.swap();
  });
  virusFlights.forEach((f) => {
    const from = f.r ? centerOf(f.r) : centerOf(anchorRect(avatarAnchor(f.e.fromPlayerId)));
    const to = slotCenter(f.pid, f.slotId);
    if (from && to) emitFx({ kind: 'trail', from, to, w: to.w, duration: f.duration || 650, delay: quick ? 0 : f.delay });
  });

  // Efectos al aterrizar (LAND), espaciados
  const STEP = quick ? 70 : 200;
  const LAND = quick ? Math.min(land, 300) : land;
  const effects = [];
  const at = (ms, fn) => effects.push({ ms, fn });
  let slotN = 0;
  for (const e of events) {
    switch (e.type) {
      case 'organPlaced':
        at(null, () => {
          const c = slotCenter(e.playerId, e.slotId);
          pulse(anchorEl(slotAnchor(e.playerId, e.slotId)), 1.05, 160);
          if (c) emitFx({ kind: 'glint', x: c.x, y: c.y, w: c.w });
        });
        break;
      case 'infected':
        at(null, () => {
          const c = slotCenter(e.playerId, e.slotId);
          pulse(anchorEl(slotAnchor(e.playerId, e.slotId)), 1.06, 160);
          if (c) emitFx({ kind: 'puff', x: c.x, y: c.y, w: c.w });
          sfx.infect();
        });
        break;
      case 'vaccinated':
        at(null, () => {
          const c = slotCenter(e.playerId, e.slotId);
          pulse(anchorEl(slotAnchor(e.playerId, e.slotId)), 1.05, 160);
          if (c) emitFx({ kind: 'glint', x: c.x, y: c.y, w: c.w });
          sfx.vaccinate();
        });
        break;
      case 'immunized':
        at(null, () => {
          const c = slotCenter(e.playerId, e.slotId);
          if (c) emitFx({ kind: 'goldWave', x: c.x, y: c.y, w: c.w * 1.2 });
          sfx.immunize();
        });
        break;
      case 'slotMoved': {
        const transplant = card?.treatment === 'transplant';
        const color = transplant ? pidColor(room, e.toPlayerId) : undefined;
        const f = pendingFlights.find((x) => x.slotId === e.slotId);
        at((quick ? 0 : f?.delay || 0) + (quick ? 450 : f?.duration || 650), () => {
          const c = slotCenter(e.toPlayerId, e.slotId);
          if (c) emitFx({ kind: 'glint', x: c.x, y: c.y, w: c.w, color });
          shake(anchorEl(`body:${e.toPlayerId}`), 4, 250);
        });
        break;
      }
      case 'virusMoved': {
        const f = virusFlights[slotN];
        slotN += 1;
        at((quick ? 0 : f?.delay || 0) + 450, () => {
          const c = slotCenter(e.toPlayerId, e.toSlotId);
          if (c) emitFx({ kind: 'puff', x: c.x, y: c.y, w: c.w });
          sfx.infect();
        });
        break;
      }
      case 'bodiesSwapped':
        at(LAND, () => {
          [e.a, e.b].forEach((pid) => {
            shake(anchorEl(`body:${pid}`), 4, 250);
            (next.players.find((p) => p.id === pid)?.body || []).forEach((s, i) => later(i * 70, () => {
              const c = slotCenter(pid, s.id);
              if (c) emitFx({ kind: 'glint', x: c.x, y: c.y, w: c.w * 0.8 });
            }));
          });
        });
        break;
      default:
        break;
    }
  }
  let i = 0;
  let lastFx = LAND;
  for (const fx of effects) {
    const ms = fx.ms ?? LAND + i * STEP;
    if (fx.ms == null) i += 1;
    lastFx = Math.max(lastFx, ms);
    later(ms, fx.fn);
  }
  later(LAND, narrateNow);

  // Victoria: ondas doradas en cada ranura del ganador, el resto de la mesa se apaga y cae la corona
  if (winEv) {
    const wid = winEv.playerId;
    later(LAND, () => {
      const root = document.querySelector('.gt-root');
      const winnerSeat = wid === me
        ? document.querySelector('.gt-me-panel')
        : anchorEl(avatarAnchor(wid))?.closest('.gt-seat');
      winnerSeat?.classList.add('is-winner');
      root?.classList.add('is-win-dim');
      (next.players.find((p) => p.id === wid)?.body || []).forEach((s, n) => later(n * 140, () => {
        const c = slotCenter(wid, s.id);
        if (c) emitFx({ kind: 'goldWave', x: c.x, y: c.y, w: c.w * 1.2 });
      }));
      sfx.immunize();
    });
    later(LAND + 450, () => {
      const a = centerOf(anchorRect(avatarAnchor(wid)));
      // Sobre la cabeza; si el avatar está pegado al borde de arriba, sobre la cara (que no se corte)
      const w = Math.max(34, a?.w * 0.7 || 0);
      if (a) emitFx({ kind: 'crownDrop', x: a.x, y: Math.max(w * 0.55, a.y - a.h * 0.62), w });
    });
    later(LAND + 1000, () => showBanner(wid === me ? '¡Ganaste!' : `¡${nameOf(wid)} ganó!`, { ms: 1300 }));
    lastFx = Math.max(lastFx, LAND + 1000);
  }

  // Esperar a que todo aterrice y sus efectos salgan (lo que sigue, robos y turnos, va después)
  const tail = glove ? 400 : 150;
  if (!(await sleep(Math.max(LAND, lastFx) + (effects.length ? STEP : 0) + tail))) return;
  narrateNow();

  // ---------- C. Lo que sigue, en orden ----------

  const drawFor = async (e) => {
    if (!e.count) return true;
    if (e.playerId === me) {
      const have = new Set(S.hand.map((c) => c.id));
      const fresh = (next.hand || []).filter((c) => !have.has(c.id));
      fresh.forEach((c, n) => setOrigin(c.id, deckC, { flip: true, delay: n * 140, scale: 0.7, rotate: 20 }));
      S.hand = next.hand || [];
      S.deckCount = Math.max(0, S.deckCount - e.count);
      show();
      sfx.draw();
      return sleep(560 + Math.max(0, fresh.length - 1) * 140);
    }
    const to = rivalDrawPoint(e.playerId, deckC);
    const n = Math.min(3, e.count);
    S.deckCount = Math.max(0, S.deckCount - e.count);
    show();
    for (let j = 0; j < n; j++) {
      emitFx({ kind: 'flyCard', from: deckC, to, w: 50, h: 62, faceDown: true, delay: T(j * 110), duration: quick ? 300 : 480, toScale: 0.9 });
      later(j * 110 + (quick ? 300 : 480), () => {
        S.counts.set(e.playerId, countOf(e.playerId) + (j === n - 1 ? e.count - (n - 1) : 1));
        show();
      });
    }
    if (n) sfx.draw();
    return sleep((n - 1) * 110 + (quick ? 300 : 480) + 60);
  };

  const start = Math.max(0, playedIdx, events.indexOf(timeoutEv));
  for (let j = start; j < events.length; j++) {
    const e = events[j];
    if (e.type === 'reshuffled') {
      // Descarte → mazo: la de arriba (boca arriba, se voltea a medio camino) y unos reversos
      const top = S.discardTop;
      const topEl = top && cardEl(top.id);
      const tr = topEl?.getBoundingClientRect() || anchorRect('discard');
      const dw = topEl?.offsetWidth || tr?.width || 60;
      const dh = topEl?.offsetHeight || tr?.height || 75;
      const angle = topEl ? screenAngle(topEl) : 0;
      if (top) emitFx({ kind: 'flyCard', from: centerOf(tr), to: deckC, w: dw, h: dh, card: top, flipMid: true, rotate: angle, toRotate: shortTurn(angle, 0), duration: 500 });
      for (let b = 1; b <= 3; b++) {
        emitFx({ kind: 'flyCard', from: discardC, to: deckC, w: dw, h: dh, faceDown: true, delay: T(b * 60), rotate: (b - 2) * 9, toRotate: 0, duration: 500 });
      }
      S.discardTop = null;
      S.discardCount = 0;
      show();
      if (!(await sleep(560 + 180))) return;
      S.deckCount = e.count;
      show();
      if (deckC) emitFx({ kind: 'shuffle', x: deckC.x, y: deckC.y, w: deckC.w, h: deckC.h });
      sfx.swap();
      if (!(await sleep(700))) return;
    } else if (e.type === 'drew') {
      if (!(await drawFor(e))) return;
    } else if (e.type === 'turnSkipped') {
      // Se le marca el turno un momento y le cae el sello
      S.turnPid = e.playerId;
      S.turnNumber = next.turnNumber;
      S.turnDeadline = next.turnDeadline;
      S.skip.delete(e.playerId);
      S.acting = null;
      show();
      stampOn(e.playerId, { text: 'PIERDE TURNO' });
      sfx.swap();
      if (e.playerId === me) showBanner('Pierdes tu turno', { sub: 'Te tocó el guante', ms: 1300 });
      if (!(await sleep(e.playerId === me ? 900 : 400))) return;
    }
  }

  // ---------- D. El turno pasa ----------

  const from = S.turnPid;
  setView(next);
  const to = next.turnPlayerId;
  if (!next.winner && to && from !== to) {
    const a = centerOf(anchorRect(avatarAnchor(from)));
    const b = centerOf(anchorRect(avatarAnchor(to)));
    if (a && b) emitFx({ kind: 'turnPass', from: a, to: b, color: pidColor(room, to), duration: 350 });
  }
  const myTurnNow = to === me && !next.winner;
  const myTurnBefore = prev.turnPlayerId === me && prev.turnNumber === next.turnNumber;
  if (myTurnNow && !myTurnBefore) {
    showBanner('¡Tu turno!');
    sfx.turn();
  }
  await sleep(quick ? 60 : 200);
};

// Red de seguridad de los intercambios: si framer no animó el cambio de layoutId (a veces pasa tras un
// intercambio de cuerpos y la carta aparece de golpe en su destino), la carta vuela por WAAPI desde
// donde estaba. Se revisa dos frames después de aplicar la vista (cuando framer ya proyectó el vuelo).
const rescueFlights = (list) => {
  const pending = list.filter((f) => f.r);
  if (!pending.length) return;
  const startedAt = performance.now();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    for (const f of pending) {
      const el = cardEl(f.id);
      const fly = el?.querySelector('.gc-fly');
      if (!fly) continue;
      const now = el.getBoundingClientRect();
      const from = centerOf(f.r);
      const at = centerOf(now);
      const dx = from.x - at.x;
      const dy = from.y - at.y;
      // Sigue cerca de donde salió: framer la está volando (o todavía espera su retraso)
      if (Math.hypot(dx, dy) < 120) continue;
      const elapsed = performance.now() - startedAt;
      const s = f.r.width && now.width ? f.r.width / now.width : 1;
      fly.getAnimations().forEach((a) => a.cancel());
      const arcX = 50 * (f.sign || 1);
      const anim = fly.animate(
        [
          { transform: `translate(${dx}px, ${dy}px) scale(${s})`, filter: 'none' },
          { transform: `translate(${dx / 2 + arcX}px, ${dy / 2 - 40}px) scale(${(s + 1) / 2 + 0.08})`, filter: 'drop-shadow(0 14px 16px rgba(20, 5, 70, 0.5))', offset: 0.5 },
          { transform: 'none', filter: 'none' },
        ],
        { duration: f.duration || 650, delay: Math.max(0, (f.delay || 0) - elapsed), easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'backwards' },
      );
      // Mientras vuela, por encima de las demás cartas
      const z = el.style.zIndex;
      el.style.zIndex = 60;
      anim.finished.catch(() => {}).finally(() => { el.style.zIndex = z; });
      console.warn('[mesa] vuelo de rescate para', f.id);
    }
  }));
};

// Todas las cartas de una ranura (órgano, virus y medicinas)
const slotCards = (s) => [s.organ, ...(s.viruses || []), ...(s.medicines || [])].filter(Boolean);

const findSlotIn = (view, pid, slotId) => view?.players?.find((x) => x.id === pid)?.body?.find((b) => b.id === slotId) || null;

// El virus que sale de una ranura en un contagio (si salen varios de la misma, uno distinto cada vez)
const findVirusId = (view, pid, slotId, taken = []) => {
  const s = findSlotIn(view, pid, slotId);
  return s?.viruses?.find((v) => !taken.includes(v.id))?.id;
};

// Anticipación del tratamiento de un rival: se marca en rojo lo que va a recibir
const aimTargets = (events, me) => {
  const AIM_MS = 1000;
  for (const e of events) {
    if (e.type === 'slotMoved') {
      const el = anchorEl(slotAnchor(e.fromPlayerId, e.slotId));
      flashClass(el, 'is-aimed', AIM_MS);
      if (e.fromPlayerId === me) shake(el, 6, 300);
    } else if (e.type === 'bodiesSwapped') {
      [e.a, e.b].forEach((pid) => {
        const el = anchorEl(`body:${pid}`);
        flashClass(el, 'is-aimed', AIM_MS);
        if (pid === me) shake(el, 6, 300);
      });
    } else if (e.type === 'virusMoved') {
      const el = anchorEl(slotAnchor(e.toPlayerId, e.toSlotId));
      flashClass(el, 'is-aimed', AIM_MS);
      if (e.toPlayerId === me) shake(el, 6, 300);
    } else if (e.type === 'handsDiscarded' && e.playerIds.includes(me)) {
      shake(anchorEl('hand:me'), 6, 300);
    }
  }
};

// Reparto inicial: las cartas salen del mazo en cascada (se llama antes del primer render de la mesa)
export const registerDeal = (view, me) => {
  if (!view || reducedMotion()) return false;
  const fresh = view.turnNumber <= 1 && (view.players || []).every((p) => (p.body || []).length === 0);
  if (!fresh) return false;
  const players = view.players || [];
  const myIdx = Math.max(0, players.findIndex((p) => p.id === me));
  const order = [...players.slice(myIdx), ...players.slice(0, myIdx)];
  // El mazo todavía no se ha pintado: se usa el centro de la ventana como origen
  const deck = { x: window.innerWidth / 2 - 60, y: window.innerHeight * 0.44 };
  for (let round = 0; round < 3; round++) {
    order.forEach((p, i) => {
      const delay = 350 + (round * order.length + i) * 110;
      if (p.id === me) {
        const c = view.hand?.[round];
        if (c) setOrigin(c.id, deck, { flip: true, delay, scale: 0.6, rotate: 30, duration: 700 });
      } else {
        setOrigin(`${p.id}:b${round}`, deck, { delay, scale: 0.7, rotate: 40, duration: 650 });
      }
    });
  }
  const total = 350 + 3 * order.length * 110;
  for (let i = 0; i < 3 * order.length; i += 2) setTimeout(() => sfx.draw(), 350 + i * 110);
  return total;
};
