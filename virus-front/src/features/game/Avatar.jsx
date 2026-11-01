import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import avatars from '../../lib/avatars';
import { avatarAnchor } from './fx';
import { useFitFont } from './fitText';
import { pressable } from './a11y';
import { EmoteBubble } from '../emotes/EmoteBubble';
import { CrownIcon } from './CrownIcon';

// Anillo de cuenta regresiva del turno: una animación CSS con la duración restante
const TurnRing = ({ size, timer }) => {
  if (!timer) return null;
  const stroke = Math.max(3, size * 0.07);
  const r = size / 2 + stroke * 0.9;
  const box = r * 2 + stroke * 2;
  const c = 2 * Math.PI * r;
  const total = Math.max(1, timer.end - timer.start);
  const elapsed = Math.min(total, Math.max(0, Date.now() - timer.start));
  return (
    <svg
      key={timer.start}
      className="gt-ring"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ left: (size - box) / 2, top: (size - box) / 2 }}
      aria-hidden
    >
      <circle className="gt-ring-track" cx={box / 2} cy={box / 2} r={r} strokeWidth={stroke} />
      <circle
        className="gt-ring-bar"
        cx={box / 2}
        cy={box / 2}
        r={r}
        strokeWidth={stroke}
        strokeDasharray={c}
        style={{
          '--c': c,
          animationDuration: `${total}ms`,
          animationDelay: `${-elapsed}ms`,
        }}
      />
    </svg>
  );
};

// Turno de un bot: en vez de la cuenta regresiva, un arco que gira (está pensando)
const SpinRing = ({ size }) => {
  const stroke = Math.max(3, size * 0.07);
  const r = size / 2 + stroke * 0.9;
  const box = r * 2 + stroke * 2;
  const c = 2 * Math.PI * r;
  return (
    <svg
      className="gt-ring gt-ring-spin"
      width={box}
      height={box}
      viewBox={`0 0 ${box} ${box}`}
      style={{ left: (size - box) / 2, top: (size - box) / 2 }}
      aria-hidden
    >
      <circle className="gt-ring-track" cx={box / 2} cy={box / 2} r={r} strokeWidth={stroke} />
      <circle className="gt-ring-arc" cx={box / 2} cy={box / 2} r={r} strokeWidth={stroke} strokeDasharray={`${c * 0.28} ${c}`} />
    </svg>
  );
};

// Globo de "pensando" (tres puntos) junto al avatar de un bot, un momento después de que empieza su turno
const THINK_AFTER_MS = 800;
const ThinkingBubble = ({ active, side, turnKey }) => {
  const [show, setShow] = useState(false);
  useEffect(() => {
    setShow(false);
    if (!active) return undefined;
    const t = setTimeout(() => setShow(true), THINK_AFTER_MS);
    return () => clearTimeout(t);
  }, [active, turnKey]);
  return (
    <AnimatePresence>
      {active && show && (
        <motion.div
          className={`emote-bubble emote-${side} gt-think`}
          role="status"
          aria-label="Pensando"
          initial={{ opacity: 0, scale: 0.3 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.15 } }}
          transition={{ type: 'spring', stiffness: 420, damping: 22 }}
        >
          <i /><i /><i />
        </motion.div>
      )}
    </AnimatePresence>
  );
};

// Nombre del jugador: hasta dos renglones dentro de su ancho máximo (para no invadir el asiento vecino).
// La letra se achica, medida en el DOM con la fuente real, hasta que quepa la palabra más larga
// sin partirla; no baja de 11 px. Sólo un nombre de una palabra larguísima se parte como último recurso.
const ALIGN = { right: 'left', left: 'right', bottom: 'center' };
const NAME_MIN_FONT = 11;
const PlayerName = ({ name, size, nameMax, compact, nameSide }) => {
  const ref = useRef(null);
  const max = Math.round(Math.max(NAME_MIN_FONT, Math.min(40, size * (compact ? 0.45 : 0.27))) * 2) / 2;
  useFitFont(ref, max, Math.min(max, NAME_MIN_FONT), [name, nameMax, nameSide]);
  return (
    <span
      ref={ref}
      className="gt-name-fit"
      style={{ maxWidth: nameMax, textAlign: ALIGN[nameSide] || 'center' }}
    >
      {name}
    </span>
  );
};

// Avatar de un jugador con su color, nombre, anillo de turno y estado
export const Avatar = memo(function Avatar({
  info, gp, size, timer, isMe = false, nameSide = 'right', targetable = false, hovered = false, onClick, compact = false, nameMax,
  bubbleSide = 'top',
}) {
  const color = info?.color || '#ffae00';
  const img = avatars[info?.avatar ?? 0] || avatars[0];
  const isTurn = !!gp?.isTurn;
  const offline = info && info.connected === false;
  const out = !!gp?.out;
  const wins = info?.wins || 0;
  const thinking = isTurn && !!info?.isBot && !gp?.acting;
  const classes = [
    'gt-avatar',
    `gt-name-${nameSide}`,
    isTurn && 'is-turn',
    offline && 'is-offline',
    out && 'is-out',
    targetable && 'is-target',
    hovered && 'is-hover',
    compact && 'is-compact',
  ].filter(Boolean).join(' ');
  // El panel del asiento ya es el destino enfocable con Tab; el avatar responde al clic y al arrastre
  const a11y = pressable(targetable ? onClick : null, `Cambiar tu cuerpo con el de ${gp?.name || info?.name || 'este jugador'}`, { focusable: false });

  return (
    <div
      className={classes}
      style={{ '--pc': color, '--as': `${size}px` }}
      data-drop={targetable ? 'player' : undefined}
      {...a11y}
      data-pid={gp?.id}
    >
      <motion.div
        className="gt-avatar-pic"
        data-anchor={avatarAnchor(gp?.id)}
        animate={isTurn ? { scale: [1, 1.06, 1] } : { scale: 1 }}
        transition={isTurn ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' } : { duration: 0.3 }}
      >
        <img src={img} alt="" draggable={false} />
        {isTurn && (thinking ? <SpinRing size={size} /> : <TurnRing size={size} timer={timer} />)}
        {offline && !out && (
          <span className="gt-badge gt-badge-off" title="Sin conexión" aria-label="Sin conexión">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M3 8.5a13 13 0 0 1 18 0M6 12a8 8 0 0 1 12 0M9.2 15.4a3.5 3.5 0 0 1 5.6 0" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
              <circle cx="12" cy="19" r="1.6" fill="currentColor" />
              <path d="M4 3l16 18" stroke="#ff4d4d" strokeWidth="2.8" strokeLinecap="round" />
            </svg>
          </span>
        )}
        {gp?.skipNext && !out && (compact
          // En el avatar compacto el letrero no cabe sin tapar el nombre: va un ícono de pausa
          ? (
            <span className="gt-badge gt-badge-skip gt-badge-skip-icon" title="Pierde su siguiente turno" aria-label="Pierde su siguiente turno">
              <svg viewBox="0 0 24 24" aria-hidden><path d="M8 6v12M16 6v12" stroke="currentColor" strokeWidth="4" strokeLinecap="round" /></svg>
            </span>
          )
          : <span className="gt-badge gt-badge-skip">pierde turno</span>)}
        {info?.isBot && <span className="gt-badge gt-badge-bot">bot</span>}
        {out && <span className="gt-badge gt-badge-out">fuera</span>}
        {wins > 0 && (
          <span className="gt-badge gt-badge-wins" title={`${wins} ${wins === 1 ? 'victoria' : 'victorias'} en esta sala`} aria-label={`${wins} ${wins === 1 ? 'victoria' : 'victorias'}`}>
            <CrownIcon />{wins}
          </span>
        )}
      </motion.div>
      {gp?.id && <EmoteBubble playerId={gp.id} side={bubbleSide} />}
      <ThinkingBubble active={thinking} side={bubbleSide} turnKey={timer?.start} />
      {nameSide !== 'none' && (
        <div className="gt-avatar-name">
          {nameMax
            ? <PlayerName name={gp?.name || info?.name || '…'} size={size} nameMax={nameMax} compact={compact} nameSide={nameSide} />
            : <span>{gp?.name || info?.name || '…'}</span>}
          {isMe && <small>tú</small>}
        </div>
      )}
    </div>
  );
});
