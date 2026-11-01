import { socket } from '../../net/socket';
import { useStore } from '../../store/useStore';
import { toast, toastError } from '../lobby/toasts';

// Avisos de amigos (se registran una sola vez, a nivel de módulo):
// - friends:invited → aviso con botón "Unirse"
// - una solicitud nueva en friends:update → aviso con botón "Ver"
const INVITE_MS = 12_000;

socket.on('friends:invited', (inv) => {
  if (!inv?.roomId || !inv.from) return;
  if (useStore.getState().room?.id === inv.roomId) return;
  toast(`${inv.from.name} te invita a «${inv.roomName}»`, 'invite', INVITE_MS, {
    label: 'Unirse',
    onClick: () => {
      useStore.getState().setFriendsOpen(false);
      useStore.getState().joinFriendRoom(inv.roomId).catch(toastError);
    },
  });
});

let seen = null; // ids de solicitudes recibidas ya vistas (null = todavía no hay lista)
useStore.subscribe((s, prev) => {
  if (!s.account) {
    seen = null;
    return;
  }
  if (s.friends === prev.friends && seen) return;
  const ids = s.friends.incoming.map((r) => r.id);
  if (seen) {
    const fresh = s.friends.incoming.filter((r) => !seen.has(r.id));
    if (fresh.length && !s.friendsOpen) {
      toast(`${fresh[0].from.name} quiere ser tu amig@`, 'invite', 8000, {
        label: 'Ver',
        onClick: () => useStore.getState().setFriendsOpen(true),
      });
    }
  }
  seen = new Set(ids);
});
