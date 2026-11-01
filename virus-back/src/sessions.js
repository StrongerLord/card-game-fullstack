// Sesiones: token → jugador. Permiten que una recarga de la página no saque al jugador.
// Cada sesión tiene un socket actual; al desconectarse arranca un periodo de gracia.
import crypto from 'node:crypto';
import { AVATAR_MAX } from './validate.js';

const DEFAULT_COLORS = ['#ffae00', '#ff5c8a', '#4cd6a0', '#4ca6ff', '#ffd23f', '#b06cff', '#ff7b39', '#3fe0d0'];
const NICKS = ['Pulga', 'Moquito', 'Garrapata', 'Piojito', 'Bichito', 'Microbio', 'Pecas', 'Chinche'];

const randomInt = (n) => crypto.randomInt(n);
const pick = (arr) => arr[randomInt(arr.length)];

export const randomColor = () => pick(DEFAULT_COLORS);
export const randomAvatar = () => randomInt(AVATAR_MAX + 1);

export function defaultProfile() {
  return { name: `${pick(NICKS)} ${100 + randomInt(900)}`, avatar: randomAvatar(), color: randomColor() };
}

export class SessionStore {
  constructor({ graceMs, onGraceExpired, log }) {
    this.graceMs = graceMs;
    this.onGraceExpired = onGraceExpired; // (session) => void
    this.log = log;
    this.byToken = new Map();
    this.byPlayerId = new Map();
    this.bySocketId = new Map();
    this.byAccount = new Map(); // accountId -> Set<session> (una cuenta puede estar en varios dispositivos)
  }

  create(profile, { ip = '' } = {}) {
    const session = {
      token: crypto.randomBytes(24).toString('base64url'),
      playerId: `p_${crypto.randomBytes(6).toString('base64url')}`,
      profile,
      socketId: null,
      connected: false,
      roomId: null,
      graceTimer: null,
      lastSeen: Date.now(),
      ip,
      accountId: null,      // cuenta de Google ligada (null = invitado)
      authToken: null,      // token de "recuérdame" con el que se ligó (para auth:logout)
      // Ventanas de rate limit: viven en la sesión (no en la sala) para que salir y volver no las reinicie
      chatTimes: [],
      joinTimes: [],
    };
    this.byToken.set(session.token, session);
    this.byPlayerId.set(session.playerId, session);
    return session;
  }

  getByToken(token) { return (token && this.byToken.get(token)) || null; }
  getById(playerId) { return this.byPlayerId.get(playerId) || null; }
  getBySocket(socketId) { return this.bySocketId.get(socketId) || null; }
  ofAccount(accountId) { return [...(this.byAccount.get(accountId) || [])]; }

  // Liga la sesión a una cuenta (o la suelta con null)
  bindAccount(session, accountId, authToken = null) {
    if (session.accountId) {
      const set = this.byAccount.get(session.accountId);
      set?.delete(session);
      if (set && !set.size) this.byAccount.delete(session.accountId);
    }
    session.accountId = accountId;
    session.authToken = accountId ? authToken : null;
    if (accountId) {
      if (!this.byAccount.has(accountId)) this.byAccount.set(accountId, new Set());
      this.byAccount.get(accountId).add(session);
    }
  }

  // Asocia el socket a la sesión. Devuelve el socketId anterior si había otro (pestaña duplicada).
  attach(session, socketId) {
    const previous = session.socketId && session.socketId !== socketId ? session.socketId : null;
    if (previous) this.bySocketId.delete(previous);
    // Si este socket ya tenía otra sesión, se suelta de ella
    const other = this.bySocketId.get(socketId);
    if (other && other !== session) this.detach(other);
    session.socketId = socketId;
    session.connected = true;
    session.lastSeen = Date.now();
    this.bySocketId.set(socketId, session);
    this.cancelGrace(session);
    return previous;
  }

  // El socket se cayó: queda desconectada y arranca la gracia (sólo importa si está en una sala)
  detach(session) {
    if (session.socketId) this.bySocketId.delete(session.socketId);
    session.socketId = null;
    session.connected = false;
    session.lastSeen = Date.now();
    this.cancelGrace(session);
    if (session.roomId) {
      session.graceTimer = setTimeout(() => {
        session.graceTimer = null;
        if (session.connected) return;
        try {
          this.onGraceExpired(session);
        } catch (err) {
          this.log.error('Error al expirar la gracia:', err);
        }
      }, this.graceMs);
    }
  }

  cancelGrace(session) {
    if (session.graceTimer) clearTimeout(session.graceTimer);
    session.graceTimer = null;
  }

  // Borra sesiones desconectadas, sin sala y viejas (para no crecer sin límite)
  prune(maxIdleMs) {
    const now = Date.now();
    let n = 0;
    for (const s of this.byToken.values()) {
      if (!s.connected && !s.roomId && now - s.lastSeen > maxIdleMs) {
        this.byToken.delete(s.token);
        this.byPlayerId.delete(s.playerId);
        if (s.accountId) this.bindAccount(s, null);
        n++;
      }
    }
    return n;
  }

  get size() { return this.byToken.size; }

  dispose() {
    for (const s of this.byToken.values()) this.cancelGrace(s);
  }
}
