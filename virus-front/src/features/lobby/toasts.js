import { create } from 'zustand';

// Mensajes en español para los códigos de error del servidor
const ERROR_TEXT = {
  ROOM_NOT_FOUND: 'Esa sala ya no existe',
  ROOM_FULL: 'La sala está llena',
  ROOM_IN_GAME: 'Esa sala ya está jugando',
  ALREADY_IN_ROOM: 'Ya estás dentro de una sala',
  NOT_HOST: 'Sólo el anfitrión puede hacer eso',
  NOT_ENOUGH_PLAYERS: 'Se necesitan al menos 2 jugadores',
  TIMEOUT: 'El servidor no respondió',
  RATE_LIMIT: '¡Más despacio! Espera un momento',
  RATE_LIMITED: '¡Más despacio! Espera un momento',
  NOT_IN_LOBBY: 'La partida ya empezó',
  NOT_IN_ROOM: 'Ya no estás en esa sala',
  NO_SESSION: 'Todavía no hay conexión con el servidor',
  SERVER_FULL: 'Hay demasiadas salas abiertas, intenta más tarde',
  PLAYER_NOT_FOUND: 'Ese jugador ya no está en la sala',
  NOT_LOGGED_IN: 'Entra con Google para tener amigos',
  AUTH_FAILED: 'Google no validó tu inicio de sesión, inténtalo otra vez',
  AUTH_DISABLED: 'El inicio de sesión con Google no está disponible',
  FRIEND_NOT_FOUND: 'No hay nadie con ese código',
  FRIEND_SELF: 'Ese es tu propio código',
  FRIEND_OFFLINE: 'Tu amig@ no está conectad@',
  NOT_FRIENDS: 'Sólo puedes invitar a tus amigos',
  REQUEST_NOT_FOUND: 'Esa solicitud ya no existe',
};

export const errorText = (err) =>
  (err && (ERROR_TEXT[err.code] || err.message)) || 'Algo salió mal';

let nextId = 1;

// Pila de avisos flotantes (los pinta <Toaster />)
export const useToasts = create((set, get) => ({
  toasts: [],
  // `action` opcional: { label, onClick } pinta un botón en el aviso (p. ej. "Unirse" en una invitación)
  push: (text, kind = 'info', ms = 3800, action = null) => {
    const id = nextId++;
    // No repetir el mismo aviso si ya está en pantalla
    if (get().toasts.some((t) => t.text === text)) return;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, kind, action }] }));
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const toast = (text, kind, ms, action) => useToasts.getState().push(text, kind, ms, action);
export const toastError = (err) => toast(errorText(err), 'error');
