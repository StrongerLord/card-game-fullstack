import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { Avatar } from '../lobby/Avatar';
import { Modal } from '../lobby/Modal';
import { CrownIcon } from '../game/CrownIcon';
import { IconCheck, IconClose, IconDoor, IconPlus, IconSend, IconUsers } from '../lobby/icons';
import { toast, toastError } from '../lobby/toasts';
import { GoogleButton } from './GoogleButton';
import './account.css';

const CODE_LEN = 6;
// Las mismas letras que acepta el servidor (sin 0/O ni 1/I/L)
const cleanCode = (v) => v.toUpperCase().replace(/[^A-HJKMNP-Z2-9]/g, '').slice(0, CODE_LEN);

const IconCopy = (p) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    <rect x="8" y="8" width="12" height="12" rx="3" />
    <path d="M16 4H7a3 3 0 0 0-3 3v9" />
  </svg>
);

// Copia al portapapeles; sin API (http en la red local) usa el truco del textarea
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}

const STATUS_TEXT = {
  offline: () => 'Desconectad@',
  online: (room) => (room ? `En la sala «${room.name}»` : 'En el lobby'),
  playing: (room) => (room ? `Jugando en «${room.name}»` : 'Jugando'),
};

// Una fila de amigo: avatar con punto de estado, nombre, dónde está y botones Invitar / Unirse
const FriendRow = ({ friend, myRoom, busy, onInvite, onJoin, onRemove }) => {
  const [confirm, setConfirm] = useState(false);
  const inMyRoom = !!myRoom && friend.room?.id === myRoom.id;
  const canInvite = !!myRoom && myRoom.status === 'lobby' && friend.status !== 'offline' && !inMyRoom;
  const canJoin = !!friend.room?.joinable && !inMyRoom;

  useEffect(() => {
    if (!confirm) return undefined;
    const t = setTimeout(() => setConfirm(false), 3000);
    return () => clearTimeout(t);
  }, [confirm]);

  return (
    <motion.li
      layout
      className={`friend-row is-${friend.status}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: 40, transition: { duration: 0.18 } }}
    >
      <Avatar avatar={friend.avatar} color={friend.color} size={44} dim={friend.status === 'offline'}>
        <span className={`friend-dot is-${friend.status}`} title={STATUS_TEXT[friend.status]?.(null)} />
      </Avatar>
      <div className="friend-row__main">
        <span className="friend-row__name" style={{ color: friend.color }}>{friend.name}</span>
        <span className="friend-row__status">
          {inMyRoom ? 'En tu sala' : (STATUS_TEXT[friend.status] || STATUS_TEXT.offline)(friend.room)}
          {friend.stats?.won > 0 && (
            <span className="friend-row__wins" title="Partidas ganadas"><CrownIcon /> {friend.stats.won}</span>
          )}
        </span>
      </div>
      <div className="friend-row__actions">
        {canJoin && (
          <motion.button
            className="ui-btn ui-btn--success ui-btn--sm"
            whileTap={{ scale: 0.92 }}
            disabled={busy === `join-${friend.id}`}
            onClick={() => onJoin(friend)}
          >
            {busy === `join-${friend.id}` ? <span className="ui-spinner" /> : <IconDoor />} Unirse
          </motion.button>
        )}
        {canInvite && (
          <motion.button
            className="ui-btn ui-btn--purple ui-btn--sm"
            whileTap={{ scale: 0.92 }}
            disabled={busy === `invite-${friend.id}`}
            onClick={() => onInvite(friend)}
          >
            {busy === `invite-${friend.id}` ? <span className="ui-spinner" /> : <IconSend />} Invitar
          </motion.button>
        )}
        <button
          type="button"
          className={`friend-row__remove ${confirm ? 'is-confirm' : ''}`}
          onClick={() => (confirm ? onRemove(friend) : setConfirm(true))}
          aria-label={confirm ? `Confirmar: quitar a ${friend.name}` : `Quitar a ${friend.name} de tus amigos`}
          title={confirm ? 'Toca otra vez para quitar' : 'Quitar de amigos'}
        >
          {confirm ? '¿Quitar?' : <IconClose />}
        </button>
      </div>
    </motion.li>
  );
};

// Panel de amigos: tu código, agregar por código, solicitudes y la lista con su estado
export const FriendsPanel = () => {
  const account = useStore((s) => s.account);
  const { friends, incoming, outgoing } = useStore((s) => s.friends);
  const myRoom = useStore((s) => s.room);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(null);

  // Al abrir, la lista fresca (por si se perdió algún friends:update)
  useEffect(() => {
    if (account) useStore.getState().refreshFriends().catch(() => {});
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account) {
    return (
      <div className="friends friends--guest">
        <span className="friends__guest-icon"><IconUsers /></span>
        <p>Para agregar amigos e invitarlos a tu sala, entra con tu cuenta de Google. Tu perfil y tus partidas quedan guardados.</p>
        <GoogleButton />
      </div>
    );
  }

  const run = async (key, fn) => {
    setBusy(key);
    try {
      await fn();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(null);
    }
  };
  const { requestFriend, respondFriend, removeFriend, inviteFriend, joinFriendRoom } = useStore.getState();

  const add = (e) => {
    e.preventDefault();
    if (code.length !== CODE_LEN) return;
    run('add', async () => {
      const res = await requestFriend(code);
      setCode('');
      toast(res.status === 'accepted' ? `¡${res.friend.name} y tú ya son amig@s!` : `Solicitud enviada a ${res.friend.name}`, 'success');
    });
  };

  const copy = async () => {
    const ok = await copyText(account.friendCode);
    toast(ok ? 'Código copiado' : `Tu código: ${account.friendCode}`, ok ? 'success' : 'info');
  };

  const online = friends.filter((f) => f.status !== 'offline').length;

  return (
    <div className="friends">
      <section className="friends__code">
        <span className="friends__label">Tu código de amigo</span>
        <div className="friends__code-row">
          <span className="friend-code" aria-label={`Tu código: ${account.friendCode.split('').join(' ')}`}>
            {account.friendCode.split('').map((ch, i) => <i key={i}>{ch}</i>)}
          </span>
          <motion.button type="button" className="ui-btn ui-btn--light ui-btn--sm" onClick={copy} whileTap={{ scale: 0.92 }}>
            <IconCopy /> Copiar
          </motion.button>
        </div>
      </section>

      <form className="friends__add" onSubmit={add}>
        <label className="friends__label" htmlFor="friend-code-input">Agregar con su código</label>
        <div className="friends__add-row">
          <input
            id="friend-code-input"
            className="ui-input friends__input"
            value={code}
            onChange={(e) => setCode(cleanCode(e.target.value))}
            placeholder="ABC123"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck="false"
            inputMode="text"
            maxLength={CODE_LEN + 2}
          />
          <motion.button
            className="ui-btn ui-btn--primary ui-btn--sm"
            disabled={code.length !== CODE_LEN || busy === 'add'}
            whileTap={{ scale: 0.92 }}
          >
            {busy === 'add' ? <span className="ui-spinner" /> : <IconPlus />} Agregar
          </motion.button>
        </div>
      </form>

      <AnimatePresence initial={false}>
        {incoming.length > 0 && (
          <motion.section
            key="incoming"
            className="friends__section friends__section--incoming"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span className="friends__label">Quieren ser tus amig@s · {incoming.length}</span>
            <ul className="friends__list">
              <AnimatePresence initial={false}>
                {incoming.map((r) => (
                  <motion.li key={r.id} layout className="friend-row is-request" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, x: 40 }}>
                    <Avatar avatar={r.from.avatar} color={r.from.color} size={44} />
                    <div className="friend-row__main">
                      <span className="friend-row__name" style={{ color: r.from.color }}>{r.from.name}</span>
                      <span className="friend-row__status">Te mandó una solicitud</span>
                    </div>
                    <div className="friend-row__actions">
                      <motion.button
                        className="ui-btn ui-btn--success ui-btn--sm"
                        whileTap={{ scale: 0.92 }}
                        disabled={!!busy}
                        onClick={() => run(`acc-${r.id}`, async () => {
                          await respondFriend(r.id, true);
                          toast(`¡${r.from.name} y tú ya son amig@s!`, 'success');
                        })}
                      >
                        <IconCheck /> Aceptar
                      </motion.button>
                      <button
                        type="button"
                        className="friend-row__remove"
                        disabled={!!busy}
                        aria-label={`Rechazar a ${r.from.name}`}
                        title="Rechazar"
                        onClick={() => run(`rej-${r.id}`, () => respondFriend(r.id, false))}
                      >
                        <IconClose />
                      </button>
                    </div>
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </motion.section>
        )}
      </AnimatePresence>

      <section className="friends__section">
        <span className="friends__label">
          Amig@s {friends.length > 0 && `· ${online} en línea de ${friends.length}`}
        </span>
        {friends.length === 0 ? (
          <p className="friends__empty">Todavía no tienes amig@s. Comparte tu código o escribe el de alguien arriba.</p>
        ) : (
          <ul className="friends__list">
            <AnimatePresence initial={false}>
              {friends.map((f) => (
                <FriendRow
                  key={f.id}
                  friend={f}
                  myRoom={myRoom}
                  busy={busy}
                  onInvite={(fr) => run(`invite-${fr.id}`, async () => {
                    await inviteFriend(fr.id);
                    toast(`Invitaste a ${fr.name}`, 'success');
                  })}
                  onJoin={(fr) => run(`join-${fr.id}`, () => joinFriendRoom(fr.room.id))}
                  onRemove={(fr) => run(`rm-${fr.id}`, async () => {
                    await removeFriend(fr.id);
                    toast(`Quitaste a ${fr.name} de tus amig@s`, 'info');
                  })}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </section>

      {outgoing.length > 0 && (
        <section className="friends__section">
          <span className="friends__label">Esperando respuesta</span>
          <ul className="friends__pending">
            {outgoing.map((r) => (
              <li key={r.id} style={{ color: r.to.color }}>{r.to.name}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

// Botón de la barra superior (con las solicitudes pendientes) y el modal de amigos.
// Sólo aparece si el servidor tiene Google activado o ya hay cuenta.
export const FriendsButton = () => {
  const account = useStore((s) => s.account);
  const clientId = useStore((s) => s.authConfig.googleClientId);
  const pending = useStore((s) => s.friends.incoming.length);
  const open = useStore((s) => s.friendsOpen);
  const setOpen = useStore((s) => s.setFriendsOpen);

  if (!account && !clientId) return null;
  return (
    <>
      <motion.button
        className="ui-icon-btn friends-btn"
        onClick={() => setOpen(true)}
        whileHover={{ rotate: -8, scale: 1.06 }}
        whileTap={{ scale: 0.88 }}
        aria-label={pending ? `Amigos (${pending} solicitudes)` : 'Amigos'}
        title="Amigos"
      >
        <IconUsers />
        <AnimatePresence>
          {pending > 0 && (
            <motion.span
              key="badge"
              className="friends-btn__badge"
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 18 }}
            >
              {pending > 9 ? '9+' : pending}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
      <Modal open={open} onClose={() => setOpen(false)} title="Amigos" labelledBy="friends-title">
        <FriendsPanel />
      </Modal>
    </>
  );
};
