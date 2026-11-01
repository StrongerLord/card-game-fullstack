// Amigos: solicitudes por código, lista con estado en vivo e invitaciones a tu sala.
// Las relaciones viven en la base (AccountStore); el estado (en línea, jugando, en qué sala) se calcula
// al momento a partir de las sesiones conectadas de cada cuenta.
import { fail } from './errors.js';
import { asObject, parseId } from './validate.js';
import { publicAccount, FRIEND_CODE_ALPHABET, FRIEND_CODE_LEN } from './accounts.js';

// Solicitudes: 10 por minuto por sesión. Invitaciones: 12 por minuto y una cada 5 s al mismo amigo
const REQUEST_BURST = 10;
const REQUEST_WINDOW_MS = 60_000;
const INVITE_BURST = 12;
const INVITE_WINDOW_MS = 60_000;
const INVITE_SAME_MS = 5000;

const CODE_RE = new RegExp(`^[${FRIEND_CODE_ALPHABET}]{${FRIEND_CODE_LEN}}$`);

export function parseFriendCode(value) {
  if (typeof value !== 'string' || value.length > 16) fail('BAD_PAYLOAD', 'Código de amigo no válido');
  const code = value.replace(/[\s-]/g, '').toUpperCase();
  if (!CODE_RE.test(code)) fail('BAD_PAYLOAD', `El código de amigo son ${FRIEND_CODE_LEN} letras y números`);
  return code;
}

// Ventana deslizante guardada en la sesión (como el chat): lanza RATE_LIMITED si se pasa
function takeSlot(session, key, burst, windowMs, message) {
  const now = Date.now();
  const times = (session[key] || []).filter((t) => now - t < windowMs);
  if (times.length >= burst) {
    session[key] = times;
    fail('RATE_LIMITED', message);
  }
  times.push(now);
  session[key] = times;
}

export class FriendService {
  constructor({ io, accounts, sessions, log }) {
    this.io = io;
    this.accounts = accounts;
    this.sessions = sessions;
    this.log = log;
    this.rooms = null; // RoomManager (se conecta después: se necesitan mutuamente)
    this.dirty = new Set();
  }

  requireAccount(session) {
    if (!session.accountId) fail('NOT_LOGGED_IN', 'Entra con Google para tener amigos');
    return session.accountId;
  }

  // Lo que ve el dueño de la cuenta (el email sólo a él)
  selfView(account) {
    return { id: account.id, email: account.email, friendCode: account.friendCode, stats: account.stats };
  }

  // Estado en vivo de una cuenta: desconectado, en línea (en el lobby o en una sala de espera) o jugando
  presence(accountId) {
    const live = this.sessions.ofAccount(accountId).filter((s) => s.connected);
    if (!live.length) return { status: 'offline', room: null };
    const inRoom = live.map((s) => (s.roomId ? this.rooms?.rooms.get(s.roomId) : null)).find(Boolean);
    if (!inRoom) return { status: 'online', room: null };
    const joinable = inRoom.status === 'lobby' && inRoom.players.length < inRoom.maxPlayers;
    return {
      status: inRoom.status === 'lobby' ? 'online' : 'playing',
      room: { id: inRoom.id, name: inRoom.name, joinable },
    };
  }

  listFor(accountId) {
    const friends = this.accounts.friendsOf(accountId).map((f) => ({
      ...publicAccount(f),
      stats: f.stats,
      ...this.presence(f.id),
    }));
    return { friends, ...this.accounts.pendingOf(accountId) };
  }

  emitToAccount(accountId, ev, data) {
    for (const s of this.sessions.ofAccount(accountId)) {
      if (s.connected && s.socketId) this.io.to(s.socketId).emit(ev, data);
    }
  }

  isOnline(accountId) {
    return this.sessions.ofAccount(accountId).some((s) => s.connected);
  }

  // Manda la lista completa a la cuenta (si tiene algún dispositivo conectado)
  push(accountId) {
    if (!this.isOnline(accountId)) return;
    this.emitToAccount(accountId, 'friends:update', this.listFor(accountId));
  }

  // El estado de estas cuentas cambió: se avisa a sus amigos conectados, agrupado en un solo envío
  markPresence(accountId) {
    if (!accountId) return;
    const first = !this.dirty.size;
    this.dirty.add(accountId);
    if (first) setImmediate(() => this.flush());
  }

  flush() {
    const changed = [...this.dirty];
    this.dirty.clear();
    const recipients = new Set();
    for (const id of changed) {
      try {
        for (const f of this.accounts.friendIdsOf(id)) recipients.add(f);
      } catch (err) {
        this.log.error('No se pudo leer la lista de amigos:', err);
      }
    }
    for (const id of recipients) {
      try { this.push(id); } catch (err) { this.log.error('No se pudo mandar friends:update:', err); }
    }
  }

  markSession(session) { this.markPresence(session?.accountId); }

  // Todas las cuentas de una sala (cambió su estado, su cupo o quién está)
  markRoom(room) {
    for (const p of room.players) {
      if (p.isBot) continue;
      this.markSession(this.sessions.getById(p.id));
    }
  }

  // ---------- eventos ----------

  list(session) {
    return this.listFor(this.requireAccount(session));
  }

  request(session, payload) {
    const me = this.requireAccount(session);
    const p = asObject(payload, { optional: false });
    const code = parseFriendCode(p.code);
    takeSlot(session, 'friendReqTimes', REQUEST_BURST, REQUEST_WINDOW_MS, 'Mandaste muchas solicitudes, espera un poco');
    const { status, target } = this.accounts.request(me, code);
    this.log.info(`Amistad ${me} → ${target.id}: ${status}`);
    this.push(me);
    this.push(target.id);
    return { status, friend: publicAccount(target) };
  }

  respond(session, payload) {
    const me = this.requireAccount(session);
    const p = asObject(payload, { optional: false });
    const requestId = parseId(p.requestId, 'requestId');
    if (typeof p.accept !== 'boolean') fail('BAD_PAYLOAD', '"accept" debe ser true o false');
    const from = this.accounts.respond(me, requestId, p.accept);
    this.push(me);
    this.push(from);
    return {};
  }

  remove(session, payload) {
    const me = this.requireAccount(session);
    const p = asObject(payload, { optional: false });
    const friendId = parseId(p.friendId, 'friendId');
    this.accounts.unfriend(me, friendId);
    this.push(me);
    this.push(friendId);
    return {};
  }

  invite(session, payload) {
    const me = this.requireAccount(session);
    const p = asObject(payload, { optional: false });
    const friendId = parseId(p.friendId, 'friendId');
    if (!this.accounts.areFriends(me, friendId)) fail('NOT_FRIENDS', 'Sólo puedes invitar a tus amigos');
    const room = this.rooms.roomOf(session);
    if (room.status !== 'lobby') fail('NOT_IN_LOBBY', 'Invita desde la sala de espera');
    if (room.players.length >= room.maxPlayers) fail('ROOM_FULL', 'Tu sala está llena');
    if (!this.isOnline(friendId)) fail('FRIEND_OFFLINE', 'Tu amig@ no está conectad@');
    if (this.sessions.ofAccount(friendId).some((s) => s.roomId === room.id)) {
      fail('ALREADY_IN_ROOM', 'Ya está en tu sala');
    }
    const now = Date.now();
    const last = session.inviteAt?.get(friendId) || 0;
    if (now - last < INVITE_SAME_MS) fail('RATE_LIMITED', 'Ya le mandaste la invitación');
    takeSlot(session, 'inviteTimes', INVITE_BURST, INVITE_WINDOW_MS, 'Mandaste muchas invitaciones, espera un poco');
    if (!session.inviteAt) session.inviteAt = new Map();
    session.inviteAt.set(friendId, now);
    this.emitToAccount(friendId, 'friends:invited', {
      from: { id: me, ...session.profile },
      roomId: room.id,
      roomName: room.name,
    });
    return {};
  }
}
