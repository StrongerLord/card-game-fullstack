import { create } from 'zustand';
import { socket, request } from '../net/socket';

const TOKEN_KEY = 'rona.token';
const PROFILE_KEY = 'rona.profile';
const CHAT_MAX = 200;

const savedProfile = () => {
  try { return JSON.parse(localStorage.getItem(PROFILE_KEY)) || null; } catch { return null; }
};
const saveProfile = (profile) => {
  try { localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)); } catch { /* sin almacenamiento */ }
};

// Lo que se limpia al salir de una sala
const NO_ROOM = { room: null, chat: [], game: null, eventQueue: [], emotes: {} };
// Cuánto se queda un emote encima del avatar (más si trae frase)
const EMOTE_MS = 2600;
const EMOTE_SAY_MS = 3600;
let emoteSeq = 0;

export const useStore = create((set, get) => ({
  connected: socket.connected,
  replaced: false,        // la sesión se abrió en otra pestaña y el servidor cortó esta
  session: null,          // { token, playerId }
  profile: savedProfile() || { name: '', avatar: 0, color: '#ffae00' },
  rooms: [],
  room: null,             // RoomState
  chat: [],
  game: null,             // PlayerView & { turnDeadline, turnMs }
  eventQueue: [],         // lotes { seq, events } pendientes de animar
  emotes: {},             // playerId -> { id, emote, say? } que se está mostrando

  hello: async () => {
    const res = await request('session:hello', {
      token: localStorage.getItem(TOKEN_KEY) || undefined,
      profile: get().profile.name ? get().profile : undefined,
    });
    localStorage.setItem(TOKEN_KEY, res.token);
    // Si el servidor ya no nos tiene en ninguna sala (se reinició o pasó la gracia), se suelta la vieja
    set({
      session: { token: res.token, playerId: res.playerId },
      profile: res.profile,
      replaced: false,
      ...(res.roomId ? {} : NO_ROOM),
    });
    if (res.profile?.name) saveProfile(res.profile);
    get().refreshRooms().catch(() => {});
    return res;
  },

  // Se guarda sólo cuando el servidor lo acepta; si lo rechaza, el perfil local no cambia
  updateProfile: async (profile) => {
    const res = await request('profile:update', profile);
    saveProfile(res.profile);
    set({ profile: res.profile });
    return res.profile;
  },

  refreshRooms: async () => {
    const res = await request('rooms:list');
    set({ rooms: res.rooms });
  },

  createRoom: (name, maxPlayers) => request('room:create', { name, maxPlayers }),
  joinRoom: (roomId) => request('room:join', { roomId }),
  leaveRoom: async () => {
    try {
      await request('room:leave');
    } catch (err) {
      // Si el servidor ya nos había sacado, salir igual
      if (err?.code !== 'NOT_IN_ROOM') throw err;
    }
    set(NO_ROOM);
  },
  addBot: (level = 'normal') => request('room:addBot', { level }),
  kick: (playerId) => request('room:kick', { playerId }),
  startGame: () => request('room:start'),
  rematch: () => request('room:rematch'),
  sendChat: (text) => request('room:chat', { text }),
  sendEmote: (emote) => request('room:emote', { emote }),
  act: (action) => request('game:action', action),

  // Vuelve a conectar esta pestaña después de que otra tomó la sesión
  reclaim: () => {
    set({ replaced: false });
    socket.connect();
  },

  // La mesa saca los lotes de eventos conforme termina de animarlos
  shiftEvents: () => set((s) => ({ eventQueue: s.eventQueue.slice(1) })),
}));

// Suscripciones del servidor (una sola vez, a nivel de módulo)
socket.on('connect', () => {
  useStore.setState({ connected: true });
  useStore.getState().hello().catch((err) => console.warn('[sesión] no se pudo saludar al servidor', err));
});
socket.on('disconnect', () => useStore.setState({ connected: false }));
socket.on('session:replaced', () => useStore.setState({ replaced: true }));
socket.on('rooms:update', (rooms) => useStore.setState({ rooms }));
socket.on('room:state', (room) => useStore.setState((s) => {
  if (!room) return NO_ROOM;
  // Otra sala distinta (o de vuelta al lobby tras la revancha): no arrastrar la partida vieja
  const changedRoom = s.room && s.room.id !== room.id;
  return {
    room,
    ...(changedRoom ? { chat: [] } : {}),
    ...(room.status === 'lobby' || changedRoom ? { game: null, eventQueue: [] } : {}),
  };
}));
// El historial se reenvía al reconectar: se ignoran los mensajes repetidos por id
socket.on('room:chat', (msg) => useStore.setState((s) => (
  msg?.id && s.chat.some((m) => m.id === msg.id) ? {} : { chat: [...s.chat.slice(-(CHAT_MAX - 1)), msg] }
)));
socket.on('game:events', (batch) => useStore.setState((s) => {
  // Lotes repetidos o viejos (p. ej. tras reconectar) no se vuelven a animar
  const last = s.eventQueue[s.eventQueue.length - 1];
  if (last && typeof batch?.seq === 'number' && batch.seq <= last.seq) return {};
  return { eventQueue: [...s.eventQueue, batch] };
}));
socket.on('game:state', (game) => useStore.setState({ game }));
// Un emote nuevo del mismo jugador reemplaza al anterior; cada uno se borra solo
socket.on('room:emote', (e) => {
  if (!e?.playerId || !e.emote) return;
  const item = { id: ++emoteSeq, emote: e.emote, say: e.say };
  useStore.setState((s) => ({ emotes: { ...s.emotes, [e.playerId]: item } }));
  setTimeout(() => useStore.setState((s) => {
    if (s.emotes[e.playerId]?.id !== item.id) return {};
    const rest = { ...s.emotes };
    delete rest[e.playerId];
    return { emotes: rest };
  }), item.say ? EMOTE_SAY_MS : EMOTE_MS);
});
