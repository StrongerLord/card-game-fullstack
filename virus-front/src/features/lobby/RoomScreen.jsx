import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { Backdrop } from '../home/Backdrop';
import { TopBar } from './TopBar';
import { Avatar } from './Avatar';
import { Chat } from './Chat';
import { toast, toastError } from './toasts';
import { useLobbyMusic } from './music';
import { EmoteBubble } from '../emotes/EmoteBubble';
import { useEmoteHotkeys } from '../emotes/EmotePicker';
import { IconClose, IconCrown, IconDoor, IconPlay, IconRobot, IconWifiOff } from './icons';
import '../home/home.css';
import './lobby.css';

const LEVELS = [
  { id: 'easy', label: 'Fácil' },
  { id: 'normal', label: 'Normal' },
];

// Asiento ocupado
const Seat = ({ player, isHost, isMe, canKick, onKick, index }) => (
  <motion.li
    layout
    className={`seat ${isMe ? 'is-me' : ''} ${player.connected ? '' : 'is-off'}`}
    style={{ '--seat-color': player.color, '--pc': player.color, '--as': '86px' }}
    initial={{ opacity: 0, scale: 0.3, rotate: index % 2 ? 12 : -12, y: 40 }}
    animate={{ opacity: 1, scale: 1, rotate: 0, y: 0 }}
    exit={{ opacity: 0, scale: 0.3, rotate: index % 2 ? -20 : 20, y: 60, transition: { duration: 0.25 } }}
    transition={{ type: 'spring', stiffness: 320, damping: 20 }}
  >
    {isHost && (
      <motion.span
        className="seat__crown"
        title="Anfitrión"
        initial={{ y: -30, opacity: 0, rotate: -30 }}
        animate={{ y: [0, -4, 0], opacity: 1, rotate: -14 }}
        transition={{ y: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' }, default: { type: 'spring', stiffness: 400, damping: 14 } }}
      >
        <IconCrown />
      </motion.span>
    )}

    {canKick && (
      <motion.button
        className="seat__kick"
        onClick={() => onKick(player)}
        whileHover={{ scale: 1.15, rotate: 90 }}
        whileTap={{ scale: 0.85 }}
        title={player.isBot ? 'Quitar bot' : `Expulsar a ${player.name}`}
        aria-label={player.isBot ? `Quitar a ${player.name}` : `Expulsar a ${player.name}`}
      >
        <IconClose />
      </motion.button>
    )}

    <Avatar avatar={player.avatar} color={player.color} size={86} dim={!player.connected}>
      {!player.connected && (
        <motion.span className="seat__off" animate={{ opacity: [1, 0.5, 1] }} transition={{ duration: 1.4, repeat: Infinity }}>
          <IconWifiOff />
        </motion.span>
      )}
      <EmoteBubble playerId={player.id} side="top" />
    </Avatar>

    <div className="seat__name" title={player.name}>{player.name}</div>

    <div className="seat__tags">
      {isMe && <span className="ui-chip seat__tag seat__tag--me">Tú</span>}
      {isHost && <span className="ui-chip seat__tag seat__tag--host">Anfitrión</span>}
      {player.isBot && <span className="ui-chip seat__tag seat__tag--bot"><IconRobot /> BOT</span>}
      {!player.connected && <span className="ui-chip seat__tag seat__tag--off">Desconectado</span>}
      {player.wins > 0 && (
        <span className="ui-chip seat__tag seat__tag--wins" title={`${player.wins} ${player.wins === 1 ? 'victoria' : 'victorias'} en esta sala`}>
          🏆 {player.wins}
        </span>
      )}
    </div>
  </motion.li>
);

// Asiento libre
const EmptySeat = ({ index }) => (
  <motion.li
    layout
    className="seat seat--empty"
    initial={{ opacity: 0, scale: 0.8 }}
    animate={{ opacity: 1, scale: 1 }}
    exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
    transition={{ type: 'spring', stiffness: 300, damping: 24 }}
  >
    <motion.div
      className="seat__placeholder"
      animate={{ scale: [1, 1.06, 1] }}
      transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut', delay: index * 0.25 }}
    >
      ?
    </motion.div>
    <div className="seat__name seat__name--empty ui-dots">Esperando</div>
  </motion.li>
);

// Sala de espera: asientos, controles del anfitrión y chat
export const RoomScreen = () => {
  const room = useStore((s) => s.room);
  const myId = useStore((s) => s.session?.playerId);
  const { leaveRoom, addBot, kick, startGame } = useStore.getState();
  const [level, setLevel] = useState('normal');
  const [busy, setBusy] = useState(null); // 'bot' | 'start' | 'leave'

  useLobbyMusic();
  useEmoteHotkeys();

  if (!room) return null;

  const isHost = room.hostId === myId;
  const host = room.players.find((p) => p.id === room.hostId);
  const full = room.players.length >= room.maxPlayers;
  const enough = room.players.length >= 2;
  const empty = Math.max(0, room.maxPlayers - room.players.length);

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

  const onKick = (player) => run(`kick-${player.id}`, async () => {
    await kick(player.id);
    toast(player.isBot ? `Quitaste a ${player.name}` : `Expulsaste a ${player.name}`, 'info');
  });

  return (
    <div className="screen room">
      <Backdrop cards={false} />
      <TopBar subtitle="Sala" title={room.name}>
        <motion.button
          className="ui-btn ui-btn--danger ui-btn--sm"
          onClick={() => run('leave', leaveRoom)}
          disabled={busy === 'leave'}
          whileTap={{ scale: 0.92 }}
        >
          <IconDoor /> Salir
        </motion.button>
      </TopBar>

      <main className="room__grid">
        <motion.section
          className="ui-panel room__table"
          initial={{ opacity: 0, y: 40, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22 }}
        >
          <div className="panel-tab">
            Jugadores {room.players.length}/{room.maxPlayers}
            {room.gamesPlayed > 0 && ` · ${room.gamesPlayed} ${room.gamesPlayed === 1 ? 'partida' : 'partidas'}`}
          </div>

          <ul className="seats" data-count={room.maxPlayers}>
            <AnimatePresence>
              {room.players.map((p, i) => (
                <Seat
                  key={p.id}
                  index={i}
                  player={p}
                  isHost={p.id === room.hostId}
                  isMe={p.id === myId}
                  canKick={isHost && p.id !== myId}
                  onKick={onKick}
                />
              ))}
              {Array.from({ length: empty }, (_, i) => <EmptySeat key={`empty-${i}`} index={i} />)}
            </AnimatePresence>
          </ul>

          <div className="room__controls">
            {isHost ? (
              <>
                <div className="bot-control">
                  <div className="segmented segmented--sm" role="radiogroup" aria-label="Nivel del bot">
                    {LEVELS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={level === l.id}
                        className={`segmented__opt ${level === l.id ? 'is-active' : ''}`}
                        onClick={() => setLevel(l.id)}
                      >
                        {level === l.id && <motion.span layoutId="bot-level" className="segmented__pill" />}
                        <span className="segmented__label">{l.label}</span>
                      </button>
                    ))}
                  </div>
                  <motion.button
                    className="ui-btn ui-btn--purple"
                    onClick={() => run('bot', () => addBot(level))}
                    disabled={full || busy === 'bot'}
                    whileTap={{ scale: 0.94 }}
                    title={full ? 'La sala está llena' : `Agregar un bot ${level === 'easy' ? 'fácil' : 'normal'}`}
                  >
                    {busy === 'bot' ? <span className="ui-spinner" /> : <IconRobot />} Agregar bot
                  </motion.button>
                </div>

                <div className="start-control">
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={enough ? 'ok' : 'wait'}
                      className="start-control__hint"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                    >
                      {enough ? '¡Todo listo!' : 'Falta al menos 1 jugador'}
                    </motion.span>
                  </AnimatePresence>
                  <motion.button
                    className="ui-btn ui-btn--primary ui-btn--lg start-control__btn"
                    onClick={() => run('start', startGame)}
                    disabled={!enough || busy === 'start'}
                    whileHover={enough ? { scale: 1.05 } : undefined}
                    whileTap={enough ? { scale: 0.93 } : undefined}
                    animate={enough ? { rotate: [0, -2, 2, -1, 0] } : { rotate: 0 }}
                    transition={enough ? { duration: 0.6, repeat: Infinity, repeatDelay: 2.4 } : undefined}
                  >
                    {busy === 'start' ? <span className="ui-spinner" /> : <IconPlay />} ¡Empezar!
                  </motion.button>
                </div>
              </>
            ) : (
              <div className="room__waiting">
                <motion.span
                  className="room__waiting-crown"
                  animate={{ rotate: [-10, 10, -10] }}
                  transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <IconCrown />
                </motion.span>
                <span className="ui-dots">
                  Esperando a que <b style={{ color: host?.color }}>{host?.name || 'el anfitrión'}</b> empiece la partida
                </span>
              </div>
            )}
          </div>
        </motion.section>

        <motion.aside
          className="ui-panel room__chat"
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.1 }}
        >
          <Chat />
        </motion.aside>
      </main>

    </div>
  );
};
