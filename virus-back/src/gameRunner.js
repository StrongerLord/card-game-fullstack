// Ejecuta una partida con el motor: aplica acciones, lleva los timers de turno,
// hace jugar a los bots y avisa a la sala de cada cambio (eventos y luego estados).
import crypto from 'node:crypto';
import {
  createGame, applyAction, advanceTimeout, removePlayer, getPlayerView, chooseBotAction,
} from '../../shared/engine/index.js';

// Veces que un mismo jugador puede recibir margen extra por reconectarse en su turno
const MAX_RECONNECT_GRANTS = 3;

// Cuánto tarda la mesa en animar un lote (aprox.): el bot empieza a "pensar" cuando el cliente terminó,
// y el reloj de un humano empieza a correr cuando ya ve que es su turno.
// Sigue la coreografía de virus-front/src/features/game/events.js (playBatch), que va EN SERIE:
//   revelación del tratamiento → acercamiento e impacto → aterrizaje y vuelos → rebarajeo → robos de cada
//   jugador uno tras otro → sellos de turno perdido → paso del turno.
// Se calcula como lo vería un rival de quien juega (el que más anima: revelación incluida).
// isHuman(playerId): el sello de un humano dura más (se le avisa en grande).
const HITS = new Set(['organDestroyed', 'cured', 'vaccineRemoved']);
const SWAPS = new Set(['slotMoved', 'bodiesSwapped', 'virusMoved']);
const MAX_ANIMATION_MS = 9000;

export const estimateAnimationMs = (events, { isHuman = () => false } = {}) => {
  if (!events.some((e) => e.type !== 'turn')) return 0;
  let ms = 40 + 200; // espera del estado + paso del turno
  if (events.some((e) => e.type === 'timeout')) ms += 400;
  const i = events.findIndex((e) => e.type === 'played');
  const played = events[i];
  const conseq = played && events[i + 1];
  // A. Tratamiento en grande al centro, o acercamiento de la carta a su objetivo e impacto
  if (played?.card?.kind === 'treatment') ms += 900;
  else if (conseq && HITS.has(conseq.type)) ms += 700 + (conseq.type === 'organDestroyed' ? 280 : 160);
  // B. Aterrizaje: vuelos de cartas (los intercambios y el guante son más largos) + efectos + respiro
  const swaps = events.filter((e) => SWAPS.has(e.type)).length;
  const glove = events.find((e) => e.type === 'handsDiscarded');
  let land = played || events.some((e) => e.type === 'discarded') ? 600 : 0;
  if (swaps) land = Math.max(land, 750 + Math.min(4, swaps) * 120);
  if (glove) land = Math.max(land, 500 + 60 * 3 * glove.playerIds.length);
  if (land) ms += land + 200 + (glove ? 400 : 150);
  if (events.some((e) => e.type === 'win')) ms += 1200;
  // C. En orden: rebarajeo, robos (uno por jugador) y sellos
  for (const e of events) {
    if (e.type === 'reshuffled') ms += 1450;
    else if (e.type === 'drew' && e.count > 0) ms += 560 + 110 * (Math.min(3, e.count) - 1);
    else if (e.type === 'turnSkipped') ms += isHuman(e.playerId) ? 900 : 400;
  }
  return Math.min(MAX_ANIMATION_MS, ms);
};

export class GameRunner {
  /**
   * @param {object} o
   * @param {{id,name}[]} o.players  en orden de asientos
   * @param {number} [o.seed]
   * @param {object} o.timing  { turnMs, disconnectedTurnMs, botMinMs, botMaxMs, reconnectTurnMs }
   * @param {(playerId) => {isBot, level, connected}} o.lookup
   * @param {(batch) => void} o.emitEvents   difunde { seq, events } a la sala
   * @param {() => void} o.emitStates        manda el game:state personalizado a cada uno
   * @param {(winner) => void} o.onFinish
   * @param {(events) => void} [o.onEvents]  cada lote ya difundido (para las reacciones de los bots)
   */
  constructor({ players, seed, timing, lookup, emitEvents, emitStates, onFinish, onEvents, log }) {
    this.timing = timing;
    this.lookup = lookup;
    this.emitEvents = emitEvents;
    this.emitStates = emitStates;
    this.onFinish = onFinish;
    this.onEvents = onEvents;
    this.log = log;
    this.state = createGame({ players, seed: seed ?? crypto.randomInt(2 ** 31) });
    this.seq = 0;
    this.animMs = 0; // lo que tarda en animarse el último lote emitido
    this.turnDeadline = 0;
    this.turnMs = timing.turnMs;
    this.timer = null;
    this.botTimer = null;
    this.disposed = false;
    this.finished = false;
    // Margen por reconexión: uno por turno y un tope por jugador en toda la partida
    // (si no, reconectar cada pocos segundos congelaba el turno para siempre)
    this.reconnectGrantTurn = 0;
    this.reconnectGrants = new Map(); // playerId -> veces que se le dio margen
  }

  get winner() { return this.state.winner; }
  get currentPlayerId() { return this.state.players[this.state.turn]?.id ?? null; }

  start() {
    const p = this.state.players[this.state.turn];
    this.commit(this.state, [{ type: 'turn', playerId: p.id, turnNumber: this.state.turnNumber }]);
  }

  // Acción de un jugador (humano o bot). Lanza GameError si es ilegal; el estado no cambia.
  act(playerId, action) {
    if (this.disposed) return;
    const { state, events } = applyAction(this.state, playerId, action);
    this.commit(state, events);
  }

  // Abandono (salió de la sala o se acabó su gracia)
  remove(playerId) {
    if (this.disposed || this.state.winner) return;
    const { state, events } = removePlayer(this.state, playerId);
    if (events.length) this.commit(state, events);
  }

  viewFor(viewerId) {
    return { ...getPlayerView(this.state, viewerId), turnDeadline: this.turnDeadline, turnMs: this.turnMs };
  }

  // Cambió la conexión de un jugador: si es su turno se ajusta el reloj.
  // Devuelve true si reenvió los estados.
  onConnectionChange(playerId) {
    if (this.disposed || this.state.winner || this.currentPlayerId !== playerId) return false;
    const info = this.lookup(playerId);
    if (!info || info.isBot) return false;
    const remaining = this.turnDeadline - Date.now();
    if (!info.connected) {
      if (remaining > this.timing.disconnectedTurnMs) this.armTurnTimer(this.timing.disconnectedTurnMs);
      else return false;
    } else {
      // Volvió (p. ej. recargó la página): que tenga un margen razonable para jugar
      const wanted = Math.min(this.timing.turnMs, this.timing.reconnectTurnMs);
      const turnNumber = this.state.turnNumber;
      const used = this.reconnectGrants.get(playerId) || 0;
      if (remaining >= wanted || this.reconnectGrantTurn === turnNumber || used >= MAX_RECONNECT_GRANTS) {
        return false;
      }
      this.reconnectGrantTurn = turnNumber;
      this.reconnectGrants.set(playerId, used + 1);
      this.armTurnTimer(wanted);
    }
    this.emitStates();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.clearTimers();
  }

  // ---------- internos ----------

  commit(state, events) {
    this.state = state;
    this.seq += 1;
    this.animMs = estimateAnimationMs(events, { isHuman: (pid) => !this.lookup(pid)?.isBot });
    this.schedule();
    this.emitEvents({ seq: this.seq, events });
    this.emitStates();
    if (this.state.winner && !this.finished) {
      this.finished = true;
      this.onFinish(this.state.winner);
    }
    try {
      this.onEvents?.(events);
    } catch (err) {
      this.log.error('Error en las reacciones de los bots:', err);
    }
  }

  clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.botTimer) clearTimeout(this.botTimer);
    this.timer = null;
    this.botTimer = null;
  }

  // grace: lo que tarda la mesa en mostrar que empezó el turno (el reloj visible arranca ahí)
  armTurnTimer(ms, grace = 0) {
    if (this.timer) clearTimeout(this.timer);
    this.turnMs = ms;
    this.turnDeadline = Date.now() + grace + ms;
    const turnNumber = this.state.turnNumber;
    this.timer = setTimeout(() => this.onTurnTimeout(turnNumber), grace + ms);
  }

  // Programa lo que toque para el jugador en turno
  schedule() {
    this.clearTimers();
    if (this.disposed || this.state.winner) {
      this.turnDeadline = 0;
      return;
    }
    const playerId = this.currentPlayerId;
    const info = this.lookup(playerId) || { isBot: false, connected: false };
    const { botMinMs, botMaxMs } = this.timing;
    // Con los tiempos reales (no los cortos de los tests) el turno empieza cuando la mesa terminó de
    // animar la jugada anterior: el bot no "piensa" mientras todavía vuelan las cartas, y el humano no
    // pierde segundos de su reloj mirando la animación
    const extra = botMinMs >= 1000 ? this.animMs : 0;
    if (info.isBot) {
      // El reloj visible es el normal, pero el bot actúa tras "pensar" un poco
      this.armTurnTimer(this.timing.turnMs, extra);
      const delay = extra + botMinMs + Math.floor(Math.random() * (Math.max(0, botMaxMs - botMinMs) + 1));
      const turnNumber = this.state.turnNumber;
      this.botTimer = setTimeout(() => this.onBotTurn(playerId, info.level, turnNumber), delay);
    } else {
      this.armTurnTimer(info.connected ? this.timing.turnMs : this.timing.disconnectedTurnMs, extra);
    }
  }

  onTurnTimeout(turnNumber) {
    this.timer = null;
    if (this.disposed || this.state.winner || this.state.turnNumber !== turnNumber) return;
    try {
      const { state, events } = advanceTimeout(this.state);
      this.commit(state, events);
    } catch (err) {
      this.log.error('Error en el timeout del turno:', err);
    }
  }

  onBotTurn(playerId, level, turnNumber) {
    this.botTimer = null;
    if (this.disposed || this.state.winner || this.state.turnNumber !== turnNumber) return;
    if (this.currentPlayerId !== playerId) return;
    try {
      // El bot sólo ve lo mismo que vería un jugador en su asiento
      const action = chooseBotAction(getPlayerView(this.state, playerId), playerId, { level });
      if (!action) return;
      this.act(playerId, action);
    } catch (err) {
      this.log.warn(`El bot ${playerId} falló (${err.code || err.message}); se resuelve por timeout`);
      try {
        const { state, events } = advanceTimeout(this.state);
        this.commit(state, events);
      } catch (err2) {
        this.log.error('Error resolviendo el turno del bot:', err2);
      }
    }
  }
}
