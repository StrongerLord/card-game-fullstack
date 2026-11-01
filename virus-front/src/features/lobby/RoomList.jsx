import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { BACK_IMAGE } from '../../lib/cards';
import { IconRefresh, IconUsers, IconStar } from './icons';

const STATUS = {
  lobby: { label: 'En espera', cls: 'is-lobby' },
  playing: { label: 'En partida', cls: 'is-playing' },
  finished: { label: 'Terminada', cls: 'is-finished' },
};

const SeatDots = ({ count, max }) => (
  <span className="room-row__seats" aria-hidden="true">
    {Array.from({ length: max }, (_, i) => (
      <i key={i} className={i < count ? 'is-full' : ''} />
    ))}
  </span>
);

const RoomRow = ({ room, onJoin, joining }) => {
  const status = STATUS[room.status] || STATUS.lobby;
  const full = room.playerCount >= room.maxPlayers;
  const canJoin = room.status === 'lobby' && !full;
  const finished = room.status === 'finished';
  const why = finished ? 'Terminada' : room.status !== 'lobby' ? 'En juego' : full ? 'Llena' : '';
  return (
    <motion.li
      layout
      className={`room-row ${canJoin ? '' : 'is-locked'} ${finished ? 'is-finished' : ''}`}
      initial={{ opacity: 0, x: 60, scale: 0.9 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: -60, scale: 0.9, transition: { duration: 0.2 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
    >
      <div className="room-row__main">
        <div className="room-row__name" title={room.name}>{room.name}</div>
        <div className="room-row__host" title="Anfitrión"><IconStar /> {room.hostName || '—'}</div>
      </div>
      <span className={`ui-chip room-row__status ${status.cls}`}>
        <i className="room-row__led" /> {status.label}
      </span>
      <div className="room-row__count" title={`${room.playerCount} de ${room.maxPlayers} jugadores`}>
        <span className="room-row__num"><IconUsers /> {room.playerCount}/{room.maxPlayers}</span>
        <SeatDots count={room.playerCount} max={room.maxPlayers} />
      </div>
      <motion.button
        className="ui-btn ui-btn--success ui-btn--sm room-row__join"
        disabled={!canJoin || joining}
        onClick={() => onJoin(room.id)}
        whileTap={{ scale: 0.92 }}
        title={canJoin ? 'Unirse a la sala' : why}
      >
        {joining ? <span className="ui-spinner" /> : canJoin ? 'Unirse' : why}
      </motion.button>
    </motion.li>
  );
};

// Lista de salas en vivo (rooms:update)
export const RoomList = ({ onJoin, joiningId }) => {
  const rooms = useStore((s) => s.rooms);
  const refreshRooms = useStore((s) => s.refreshRooms);
  const [spin, setSpin] = useState(0);

  // Primero las que aceptan gente, luego las llenas, las que están jugando y al final las terminadas
  const rank = (r) => (r.status === 'lobby' && r.playerCount < r.maxPlayers ? 0 : r.status === 'lobby' ? 1 : r.status === 'finished' ? 3 : 2);
  const sorted = [...rooms].sort((a, b) => rank(a) - rank(b));
  const open = rooms.filter((r) => rank(r) === 0).length;

  return (
    <section className="room-list">
      <header className="room-list__header">
        <h2 className="ui-panel__title">Salas</h2>
        <span className="room-list__count">
          <motion.b key={rooms.length} initial={{ scale: 1.6 }} animate={{ scale: 1 }}>{rooms.length}</motion.b>
          {' '}{rooms.length === 1 ? 'sala' : 'salas'} · {open} con lugar
        </span>
        <motion.button
          className="ui-icon-btn room-list__refresh"
          onClick={() => { setSpin((n) => n + 1); refreshRooms().catch(() => {}); }}
          animate={{ rotate: spin * 360 }}
          transition={{ type: 'spring', stiffness: 120, damping: 14 }}
          aria-label="Actualizar salas"
          title="Actualizar"
        >
          <IconRefresh />
        </motion.button>
      </header>

      <div className="room-list__scroll">
        {sorted.length === 0 ? (
          <motion.div
            className="room-list__empty"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <motion.img
              src={BACK_IMAGE}
              alt=""
              animate={{ rotateY: [0, 180, 360], y: [0, -10, 0] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
            />
            <p>No hay salas todavía.</p>
            <p className="room-list__empty-sub">¡Crea la primera y llama a tus amigos!</p>
          </motion.div>
        ) : (
          <ul className="room-list__items">
            <AnimatePresence initial>
              {sorted.map((room) => (
                <RoomRow key={room.id} room={room} onJoin={onJoin} joining={joiningId === room.id} />
              ))}
            </AnimatePresence>
          </ul>
        )}
      </div>
    </section>
  );
};
