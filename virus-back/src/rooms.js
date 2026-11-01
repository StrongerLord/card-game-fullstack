// Salas: lobby, anfitrión, bots, chat, partida y revancha.
// Es la única pieza que difunde estados de sala y de partida por Socket.IO.
import crypto from 'node:crypto';
import { fail } from './errors.js';
import { GameRunner } from './gameRunner.js';
import { reactionsFor, replyTo } from './botTalk.js';
import { EMOTES } from '../../shared/emotes.js';
import { randomColor } from './sessions.js';
import {
  asObject, parseText, parseId, parseRoomId, parseAction, ROOM_NAME_MAX, CHAT_MAX, AVATAR_MAX,
} from './validate.js';

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_ROOMS = 200;
const CHAT_HISTORY = 50;
const CHAT_BURST = 5;
const CHAT_WINDOW_MS = 5000;
// Entrar a salas (unirse o crear) por sesión: frena el bucle salir/entrar que inunda el chat de avisos
const JOIN_BURST = 6;
const JOIN_WINDOW_MS = 30_000;
// Emotes: 4 por sesión cada 3 s; un bot no reacciona más de una vez cada 3.5 s
const EMOTE_BURST = 4;
const EMOTE_WINDOW_MS = 3000;
const BOT_EMOTE_COOLDOWN_MS = 3500;
// Uno al azar de `list` que no esté en `used`; si ya se usaron todos, cualquiera
const pickUnused = (list, used) => {
  const free = list.filter((x) => !used.has(x));
  const from = free.length ? free : list;
  return from[crypto.randomInt(from.length)];
};
// Igual, para generadores sin lista (los colores viven en sessions.js): hasta 20 intentos
const randomUnused = (gen, used) => {
  for (let i = 0; i < 20; i++) {
    const v = gen();
    if (!used.has(v)) return v;
  }
  return gen();
};
const AVATAR_IDS = Array.from({ length: AVATAR_MAX + 1 }, (_, i) => i);

const ROOM_ID_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const BOT_NAMES = [
  'Doctor Mocos', 'Tía Bacteria', 'Don Estornudo', 'Sor Jarabe', 'Comandante Tos',
  'Señorita Fiebre', 'Licenciado Moco', 'Doña Roña', 'Profe Paracetamol', 'Capitán Vacuna',
  'Chuy Microbio', 'La Güera Gripa', 'El Compa Virus', 'Nana Curita', 'Tío Comezón',
  'Lady Sarampión', 'Don Gargajo', 'Mister Pañuelo', 'La Jeringa', 'Varicelo',
];

const LEAVE_VERBS = { leave: 'salió', kick: 'fue expulsado', timeout: 'se desconectó' };

const channel = (roomId) => `room:${roomId}`;

export class RoomManager {
  constructor({ io, sessions, timing, log, limits = {} }) {
    this.limits = limits;
    this.io = io;
    this.sessions = sessions;
    this.timing = timing;
    this.log = log;
    this.rooms = new Map();
    this.listDirty = false;
  }

  // ---------- consultas ----------

  list() {
    return [...this.rooms.values()].map((r) => this.summary(r));
  }

  summary(room) {
    const host = room.players.find((p) => p.id === room.hostId);
    return {
      id: room.id,
      name: room.name,
      playerCount: room.players.length,
      maxPlayers: room.maxPlayers,
      status: room.status,
      hostName: host ? host.name : '',
    };
  }

  roomState(room) {
    return {
      id: room.id,
      name: room.name,
      hostId: room.hostId,
      maxPlayers: room.maxPlayers,
      status: room.status,
      gamesPlayed: room.gamesPlayed,
      players: room.players.map((p) => ({
        id: p.id,
        name: p.name,
        avatar: p.avatar,
        color: p.color,
        isBot: p.isBot,
        connected: this.isConnected(p),
        wins: room.wins.get(p.id) || 0,
      })),
    };
  }

  isConnected(p) {
    if (p.isBot) return true;
    const s = this.sessions.getById(p.id);
    return !!(s && s.connected);
  }

  roomOf(session) {
    const room = session.roomId ? this.rooms.get(session.roomId) : null;
    if (!room) fail('NOT_IN_ROOM', 'No estás en ninguna sala');
    return room;
  }

  assertHost(room, session) {
    if (room.hostId !== session.playerId) fail('NOT_HOST', 'Sólo el anfitrión puede hacer eso');
  }

  // ---------- difusión ----------

  socketOf(session) {
    return session.connected && session.socketId ? this.io.sockets.sockets.get(session.socketId) || null : null;
  }

  emitTo(playerId, ev, data) {
    const s = this.sessions.getById(playerId);
    if (s && s.connected && s.socketId) this.io.to(s.socketId).emit(ev, data);
  }

  broadcastRoom(room) {
    this.io.to(channel(room.id)).emit('room:state', this.roomState(room));
  }

  // rooms:update se agrupa: varios cambios seguidos producen un solo envío
  markListDirty() {
    if (this.listDirty) return;
    this.listDirty = true;
    setImmediate(() => {
      this.listDirty = false;
      this.io.emit('rooms:update', this.list());
    });
  }

  pushChat(room, msg) {
    room.chat.push(msg);
    if (room.chat.length > CHAT_HISTORY) room.chat.shift();
    this.io.to(channel(room.id)).emit('room:chat', msg);
  }

  system(room, text) {
    this.pushChat(room, { id: crypto.randomUUID(), from: null, text, ts: Date.now(), system: true });
  }

  // Sólo a quien juega esa partida (no a alguien que entró después)
  sendGameState(room, playerId) {
    if (room.runner && room.runner.state.players.some((p) => p.id === playerId)) this.emitTo(playerId, 'game:state', room.runner.viewFor(playerId));
  }

  // Mete el socket del jugador en el canal de la sala y le manda lo que necesita
  syncSocket(room, session, { withHistory }) {
    const socket = this.socketOf(session);
    if (socket) socket.join(channel(room.id));
    this.emitTo(session.playerId, 'room:state', this.roomState(room));
    if (withHistory) for (const msg of room.chat) this.emitTo(session.playerId, 'room:chat', msg);
    this.sendGameState(room, session.playerId);
  }

  // ---------- lobby ----------

  create(session, payload) {
    const p = asObject(payload);
    if (session.roomId && this.rooms.has(session.roomId)) fail('ALREADY_IN_ROOM', 'Ya estás en una sala');
    if (this.rooms.size >= MAX_ROOMS) fail('SERVER_FULL', 'Hay demasiadas salas abiertas, intenta más tarde');
    const maxPerIp = this.limits.maxRoomsPerIp;
    if (maxPerIp && session.ip) {
      let mine = 0;
      for (const r of this.rooms.values()) if (r.creatorIp === session.ip) mine++;
      if (mine >= maxPerIp) fail('RATE_LIMITED', 'Ya hay demasiadas salas abiertas desde tu red');
    }
    const emptyName = p.name === undefined || p.name === null || (typeof p.name === 'string' && p.name.trim() === '');
    const name = emptyName
      ? [...`Sala de ${session.profile.name}`].slice(0, ROOM_NAME_MAX).join('')
      : parseText(p.name, { field: 'name', max: ROOM_NAME_MAX });
    let maxPlayers = MAX_PLAYERS;
    if (p.maxPlayers !== undefined && p.maxPlayers !== null) {
      if (!Number.isInteger(p.maxPlayers) || p.maxPlayers < MIN_PLAYERS || p.maxPlayers > MAX_PLAYERS) {
        fail('BAD_PAYLOAD', `"maxPlayers" debe ser un entero de ${MIN_PLAYERS} a ${MAX_PLAYERS}`);
      }
      maxPlayers = p.maxPlayers;
    }
    const room = {
      id: this.newRoomId(),
      name,
      hostId: session.playerId,
      maxPlayers,
      status: 'lobby',
      players: [],
      chat: [],
      runner: null,
      wins: new Map(),        // playerId -> partidas ganadas en esta sala
      gamesPlayed: 0,
      botEmoteAt: new Map(),  // botId -> última vez que reaccionó
      timers: new Set(),      // reacciones de bots pendientes
      createdAt: Date.now(),
      creatorIp: session.ip || '',
    };
    this.takeJoinSlot(session);
    this.rooms.set(room.id, room);
    this.addHuman(room, session);
    this.log.info(`Sala ${room.id} "${room.name}" creada por ${session.profile.name}`);
    this.system(room, `${session.profile.name} creó la sala`);
    this.syncSocket(room, session, { withHistory: true });
    this.markListDirty();
    return { roomId: room.id };
  }

  join(session, payload) {
    const p = asObject(payload, { optional: false });
    const roomId = parseRoomId(p.roomId);
    if (session.roomId) {
      if (session.roomId === roomId) fail('ALREADY_IN_ROOM', 'Ya estás en esta sala');
      if (this.rooms.has(session.roomId)) fail('ALREADY_IN_ROOM', 'Ya estás en otra sala');
    }
    const room = this.rooms.get(roomId);
    if (!room) fail('ROOM_NOT_FOUND', 'Esa sala no existe');
    if (room.status === 'playing') fail('ROOM_IN_GAME', 'La partida ya empezó');
    if (room.status !== 'lobby') fail('ROOM_IN_GAME', 'Esa partida acaba de terminar; espera a la revancha');
    if (room.players.length >= room.maxPlayers) fail('ROOM_FULL', 'La sala está llena');
    this.takeJoinSlot(session);
    this.addHuman(room, session);
    this.log.info(`${session.profile.name} entró a la sala ${room.id}`);
    this.broadcastRoom(room); // a los que ya estaban
    this.syncSocket(room, session, { withHistory: true });
    this.system(room, `${session.profile.name} se unió`);
    this.markListDirty();
    return {};
  }

  // Cuenta una entrada a sala; lanza RATE_LIMITED si fueron demasiadas en la ventana
  takeJoinSlot(session) {
    const now = Date.now();
    const times = (session.joinTimes || []).filter((t) => now - t < JOIN_WINDOW_MS);
    if (times.length >= JOIN_BURST) {
      session.joinTimes = times;
      fail('RATE_LIMITED', 'Entras y sales muy rápido, espera unos segundos');
    }
    times.push(now);
    session.joinTimes = times;
  }

  addHuman(room, session) {
    const { name, avatar, color } = session.profile;
    room.players.push({ id: session.playerId, name, avatar, color, isBot: false });
    session.roomId = room.id;
  }

  // Salida voluntaria ('leave'), por expulsión ('kick') o por gracia agotada ('timeout')
  leave(session, reason = 'leave') {
    const room = session.roomId ? this.rooms.get(session.roomId) : null;
    session.roomId = null;
    this.sessions.cancelGrace(session);
    if (!room) return {};
    const socket = this.socketOf(session);
    if (socket) socket.leave(channel(room.id));
    this.emitTo(session.playerId, 'room:state', null);
    this.removeFromRoom(room, session.playerId, reason);
    return {};
  }

  removeFromRoom(room, playerId, reason) {
    const idx = room.players.findIndex((p) => p.id === playerId);
    if (idx === -1) return;
    const [player] = room.players.splice(idx, 1);
    const verb = LEAVE_VERBS[reason] || 'salió';
    this.log.info(`${player.name} ${verb} de la sala ${room.id}`);

    // Una sala sin humanos se borra (aunque queden bots jugando)
    if (!room.players.some((p) => !p.isBot)) {
      this.destroy(room);
      return;
    }
    if (room.hostId === playerId) {
      const humans = room.players.filter((p) => !p.isBot);
      const next = humans.find((p) => this.isConnected(p)) || humans[0];
      room.hostId = next.id;
      this.log.info(`Sala ${room.id}: ahora el anfitrión es ${next.name}`);
    }
    this.broadcastRoom(room);
    this.system(room, `${player.name} ${verb}`);
    if (room.status === 'playing' && room.runner) room.runner.remove(playerId);
    this.markListDirty();
  }

  destroy(room) {
    if (room.runner) room.runner.dispose();
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
    room.runner = null;
    this.rooms.delete(room.id);
    for (const p of room.players) {
      if (p.isBot) continue;
      const s = this.sessions.getById(p.id);
      if (s && s.roomId === room.id) s.roomId = null;
    }
    this.io.in(channel(room.id)).socketsLeave(channel(room.id));
    this.log.info(`Sala ${room.id} borrada (sin humanos)`);
    this.markListDirty();
  }

  addBot(session, payload) {
    const p = asObject(payload);
    const room = this.roomOf(session);
    this.assertHost(room, session);
    if (room.status !== 'lobby') fail('NOT_IN_LOBBY', 'Sólo se pueden agregar bots en la sala de espera');
    let level = 'normal';
    if (p.level !== undefined && p.level !== null) {
      if (p.level !== 'easy' && p.level !== 'normal') fail('BAD_PAYLOAD', '"level" debe ser "easy" o "normal"');
      level = p.level;
    }
    if (room.players.length >= room.maxPlayers) fail('ROOM_FULL', 'La sala está llena');
    const used = new Set(room.players.map((x) => x.name));
    const free = BOT_NAMES.filter((n) => !used.has(n));
    const name = free.length ? free[crypto.randomInt(free.length)] : `Bot ${room.players.length + 1}`;
    const bot = {
      id: `bot_${crypto.randomBytes(5).toString('base64url')}`,
      name,
      // Avatar y color que no tenga nadie más en la sala, para distinguirlos en la mesa
      avatar: pickUnused(AVATAR_IDS, new Set(room.players.map((x) => x.avatar))),
      color: randomUnused(randomColor, new Set(room.players.map((x) => String(x.color).toLowerCase()))),
      isBot: true,
      level,
    };
    room.players.push(bot);
    this.broadcastRoom(room);
    this.system(room, `${bot.name} (bot${level === 'easy' ? ' fácil' : ''}) se unió`);
    this.markListDirty();
    return { playerId: bot.id };
  }

  kick(session, payload) {
    const p = asObject(payload, { optional: false });
    const playerId = parseId(p.playerId, 'playerId');
    const room = this.roomOf(session);
    this.assertHost(room, session);
    if (room.status !== 'lobby') fail('NOT_IN_LOBBY', 'Sólo se puede expulsar en la sala de espera');
    if (playerId === session.playerId) fail('BAD_PAYLOAD', 'No puedes expulsarte a ti mismo');
    const target = room.players.find((x) => x.id === playerId);
    if (!target) fail('PLAYER_NOT_FOUND', 'Ese jugador no está en la sala');
    const targetSession = target.isBot ? null : this.sessions.getById(playerId);
    if (targetSession) this.leave(targetSession, 'kick');
    else this.removeFromRoom(room, playerId, 'kick');
    return {};
  }

  chat(session, payload) {
    const p = asObject(payload, { optional: false });
    const text = parseText(p.text, { field: 'text', max: CHAT_MAX });
    const room = this.roomOf(session);
    const now = Date.now();
    // La ventana vive en la sesión: salir y volver a entrar no la reinicia
    const times = (session.chatTimes || []).filter((t) => now - t < CHAT_WINDOW_MS);
    if (times.length >= CHAT_BURST) {
      session.chatTimes = times;
      fail('RATE_LIMITED', 'Vas muy rápido, espera unos segundos');
    }
    times.push(now);
    session.chatTimes = times;
    const me = room.players.find((x) => x.id === session.playerId);
    this.pushChat(room, {
      id: crypto.randomUUID(),
      from: {
        id: session.playerId,
        name: me ? me.name : session.profile.name,
        color: me ? me.color : session.profile.color,
      },
      text,
      ts: now,
      system: false,
    });
    return {};
  }

  // Emote rápido: no queda en el historial, sólo se difunde a la sala
  emote(session, payload) {
    const p = asObject(payload, { optional: false });
    if (typeof p.emote !== 'string' || !Object.hasOwn(EMOTES, p.emote)) fail('BAD_PAYLOAD', '"emote" no es un emote válido');
    const room = this.roomOf(session);
    if (!room.players.some((x) => x.id === session.playerId)) fail('NOT_IN_ROOM', 'No estás en esa sala');
    const now = Date.now();
    const times = (session.emoteTimes || []).filter((t) => now - t < EMOTE_WINDOW_MS);
    if (times.length >= EMOTE_BURST) {
      session.emoteTimes = times;
      fail('RATE_LIMITED', 'Tranquilo, espera tantito');
    }
    times.push(now);
    session.emoteTimes = times;
    this.emitEmote(room, { playerId: session.playerId, emote: p.emote });
    // A veces un bot le contesta
    const reply = this.timing.botReactions ? replyTo(p.emote, this.activeBots(room)) : null;
    if (reply) this.scheduleBotReactions(room, [reply]);
    return {};
  }

  // Reacciones pendientes de la partida anterior: que no salgan en la siguiente
  clearBotReactions(room) {
    for (const t of room.timers) clearTimeout(t);
    room.timers.clear();
    room.botEmoteAt.clear();
  }

  emitEmote(room, { playerId, emote, say }) {
    this.io.to(channel(room.id)).emit('room:emote', { playerId, emote, ...(say ? { say } : {}), ts: Date.now() });
  }

  // Bots de la sala que siguen en la mesa (en partida, los que no han salido)
  activeBots(room) {
    const out = new Set(room.runner?.state.players.filter((p) => p.out).map((p) => p.id) || []);
    return room.players.filter((p) => p.isBot && !out.has(p.id)).map((p) => p.id);
  }

  // Cada reacción sale tras un respiro (que se alcance a ver la animación de la jugada)
  scheduleBotReactions(room, reactions) {
    const now = Date.now();
    const { botReactMinMs: min, botReactMaxMs: max } = this.timing;
    for (const r of reactions) {
      if (now - (room.botEmoteAt.get(r.playerId) || 0) < BOT_EMOTE_COOLDOWN_MS) continue;
      room.botEmoteAt.set(r.playerId, now);
      const t = setTimeout(() => {
        room.timers.delete(t);
        if (this.rooms.get(room.id) !== room || !room.players.some((x) => x.id === r.playerId)) return;
        this.emitEmote(room, r);
      }, min + Math.floor(Math.random() * (Math.max(0, max - min) + 1)));
      room.timers.add(t);
    }
  }

  // El perfil cambió: se refleja en la sala (la partida en curso conserva el nombre del motor)
  onProfileChanged(session) {
    const room = session.roomId ? this.rooms.get(session.roomId) : null;
    if (!room) return;
    const me = room.players.find((x) => x.id === session.playerId);
    if (!me) return;
    Object.assign(me, session.profile);
    this.broadcastRoom(room);
    this.markListDirty();
  }

  // ---------- partida ----------

  start(session, payload) {
    asObject(payload);
    const room = this.roomOf(session);
    this.assertHost(room, session);
    if (room.status !== 'lobby') fail('NOT_IN_LOBBY', 'La partida ya empezó');
    if (room.players.length < MIN_PLAYERS) fail('NOT_ENOUGH_PLAYERS', `Se necesitan al menos ${MIN_PLAYERS} jugadores`);

    // Asientos al azar: así no empieza siempre el anfitrión
    const seats = [...room.players];
    if (!this.timing.fixedSeats) {
      for (let i = seats.length - 1; i > 0; i--) {
        const j = crypto.randomInt(i + 1);
        [seats[i], seats[j]] = [seats[j], seats[i]];
      }
    }
    const runner = new GameRunner({
      players: seats.map((x) => ({ id: x.id, name: x.name })),
      seed: this.timing.seed,
      timing: this.timing,
      log: this.log,
      lookup: (id) => {
        const pl = room.players.find((x) => x.id === id);
        if (!pl) return { isBot: false, connected: false };
        return { isBot: pl.isBot, level: pl.level, connected: this.isConnected(pl) };
      },
      emitEvents: (batch) => this.io.to(channel(room.id)).emit('game:events', batch),
      emitStates: () => {
        for (const pl of room.players) if (!pl.isBot) this.sendGameState(room, pl.id);
      },
      onFinish: (winner) => this.onGameFinished(room, winner),
      onEvents: (events) => {
        if (this.timing.botReactions) this.scheduleBotReactions(room, reactionsFor(events, this.activeBots(room)));
      },
    });
    room.runner = runner;
    room.status = 'playing';
    this.log.info(`Partida en la sala ${room.id} con ${seats.length} jugadores`);
    this.broadcastRoom(room);
    this.system(room, '¡Empieza la partida!');
    this.markListDirty();
    runner.start();
    return {};
  }

  act(session, payload) {
    const action = parseAction(payload);
    const room = this.roomOf(session);
    if (!room.runner) fail('NOT_PLAYING', 'No hay ninguna partida en curso');
    if (room.status !== 'playing') fail('GAME_OVER', 'La partida ya terminó');
    room.runner.act(session.playerId, action);
    return {};
  }

  onGameFinished(room, winner) {
    if (this.rooms.get(room.id) !== room) return;
    room.status = 'finished';
    room.gamesPlayed += 1;
    if (room.players.some((p) => p.id === winner.playerId)) {
      room.wins.set(winner.playerId, (room.wins.get(winner.playerId) || 0) + 1);
    }
    this.handOffHostIfAway(room, { announce: false });
    const name = room.runner?.state.players.find((p) => p.id === winner.playerId)?.name || 'Alguien';
    this.log.info(`Sala ${room.id}: ganó ${name} (${winner.reason})`);
    this.broadcastRoom(room);
    this.system(room, winner.reason === 'forfeit'
      ? `${name} ganó: los demás abandonaron`
      : `¡${name} ganó la partida!`);
    this.markListDirty();
  }

  rematch(session, payload) {
    asObject(payload);
    const room = this.roomOf(session);
    this.assertHost(room, session);
    if (room.status !== 'finished') fail('NOT_FINISHED', 'La partida todavía no termina');
    if (room.runner) room.runner.dispose();
    room.runner = null;
    this.clearBotReactions(room);
    room.status = 'lobby';
    this.broadcastRoom(room);
    this.system(room, '¡Revancha! De vuelta a la sala de espera');
    this.markListDirty();
    return {};
  }

  // ---------- conexión ----------

  // La sesión se recuperó con un socket nuevo: vuelve a su canal y recibe el estado
  onSessionRestored(session) {
    const room = session.roomId ? this.rooms.get(session.roomId) : null;
    if (!room) {
      session.roomId = null;
      return;
    }
    const socket = this.socketOf(session);
    if (socket) socket.join(channel(room.id));
    this.broadcastRoom(room); // le llega también a él y avisa a los demás que volvió
    // El historial del chat (el cliente descarta los repetidos por id): tras una recarga no aparece vacío
    for (const msg of room.chat) this.emitTo(session.playerId, 'room:chat', msg);
    // Si era su turno se le devuelve margen y eso ya reenvía los estados; si no, sólo el suyo
    const resent = room.status === 'playing' && room.runner && room.runner.onConnectionChange(session.playerId);
    if (!resent) this.sendGameState(room, session.playerId);
  }

  // Si el anfitrión está desconectado y no hay partida en curso, el rol pasa al primer humano
  // conectado (si no, la sala quedaba bloqueada toda la gracia: nadie podía iniciar ni agregar bots)
  handOffHostIfAway(room, { announce = true } = {}) {
    if (room.status === 'playing') return false;
    const host = room.players.find((p) => p.id === room.hostId);
    if (host && this.isConnected(host)) return false;
    const next = room.players.find((p) => !p.isBot && p.id !== room.hostId && this.isConnected(p));
    if (!next) return false;
    room.hostId = next.id;
    this.log.info(`Sala ${room.id}: el anfitrión se desconectó, ahora lo es ${next.name}`);
    if (announce) this.system(room, `${next.name} ahora es el anfitrión`);
    this.markListDirty();
    return true;
  }

  onDisconnected(session) {
    const room = session.roomId ? this.rooms.get(session.roomId) : null;
    if (!room) return;
    this.handOffHostIfAway(room);
    this.broadcastRoom(room);
    if (room.status === 'playing' && room.runner) room.runner.onConnectionChange(session.playerId);
  }

  // Pasó la gracia sin volver: pierde el asiento
  onGraceExpired(session) {
    if (session.roomId) this.leave(session, 'timeout');
  }

  newRoomId() {
    for (;;) {
      let id = '';
      for (let i = 0; i < 5; i++) id += ROOM_ID_ALPHABET[crypto.randomInt(ROOM_ID_ALPHABET.length)];
      if (!this.rooms.has(id)) return id;
    }
  }

  dispose() {
    for (const room of this.rooms.values()) {
      room.runner?.dispose();
      for (const t of room.timers) clearTimeout(t);
    }
    this.rooms.clear();
  }
}
