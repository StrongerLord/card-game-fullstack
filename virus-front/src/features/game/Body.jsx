import { memo, useEffect, useLayoutEffect, useState } from 'react';
import { slotStatus } from '@shared/engine/index.js';
import { GameCard } from './GameCard';
import { STACK_EXTRA, STACK_STEP } from './layout';
import { slotAnchor, takeArriving } from './fx';
import { pressable } from './a11y';
import { COLOR_NAMES } from '../../lib/cards';

export const slotKey = (playerId, slotId) => `${playerId}:${slotId}`;

const safeStatus = (slot) => {
  try { return slotStatus(slot); } catch { return 'healthy'; }
};

// Íconos del estado de la ranura
const ShieldIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5l-8-3Z" fill="#ffd34d" stroke="#8a5a00" strokeWidth="1.6" />
    <path d="M12 4.3 6 6.6V11c0 3.8 2.5 7.2 6 8.6" fill="#fff3b0" opacity=".75" />
    <path d="m8.5 12 2.4 2.4 4.8-5" fill="none" stroke="#8a5a00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const GermIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <g stroke="#1d4d10" strokeWidth="1.6" strokeLinecap="round">
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
    </g>
    <circle cx="12" cy="12" r="6.2" fill="#8cff4d" stroke="#1d4d10" strokeWidth="1.6" />
    <circle cx="10" cy="11" r="1.2" fill="#1d4d10" />
    <circle cx="14.2" cy="11" r="1.2" fill="#1d4d10" />
    <path d="M9.8 14.4c1.4-1 3-1 4.4 0" fill="none" stroke="#1d4d10" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);
const DropIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M12 2.8s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11Z" fill="#7fe9ff" stroke="#0b5c75" strokeWidth="1.6" />
    <path d="M9 14.5a3 3 0 0 0 3 3" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

const STATUS_LABEL = { healthy: 'sano', infected: 'infectado', vaccinated: 'vacunado', immunized: 'inmunizado' };

// "tu corazón, infectado" / "cerebro de Beto, vacunado"
const slotLabel = (slot, status, ownerName, mine) => {
  const organ = COLOR_NAMES[slot.organ?.color] || 'órgano';
  return `${mine ? `tu ${organ}` : `${organ} de ${ownerName || 'otro jugador'}`}, ${STATUS_LABEL[status]}`;
};

// Una ranura: el órgano con sus virus y medicinas apilados encima, desplazados hacia abajo
export const BodySlot = memo(function BodySlot({ slot, playerId, w, h, targetable, picked, hovered, dimmed, onSlot, ownerName, mine }) {
  const status = safeStatus(slot);
  // Si el reproductor de eventos marcó esta ranura, su insignia y su aura esperan a que la carta aterrice
  // (al montarse en otro cuerpo o al cambiar de estado); se lee antes del primer pintado
  const [arrive, setArrive] = useState(null);
  useLayoutEffect(() => {
    const a = takeArriving(slot.id);
    if (a) setArrive({ delay: a.delay, n: Date.now() });
  }, [status, slot.id]);
  useEffect(() => {
    if (!arrive) return undefined;
    const t = setTimeout(() => setArrive(null), arrive.delay + 600);
    return () => clearTimeout(t);
  }, [arrive]);
  const mods = [...(slot.viruses || []), ...(slot.medicines || [])];
  const stackH = h * (1 + STACK_STEP * mods.length);
  const classes = [
    'gt-slot',
    `st-${status}`,
    targetable && 'is-target',
    picked && 'is-picked',
    hovered && 'is-hover',
    dimmed && 'is-dim',
    arrive && 'is-arriving',
  ].filter(Boolean).join(' ');
  const label = slotLabel(slot, status, ownerName, mine);
  // Si es destino, es un botón (clic, Enter o Espacio); si no, una imagen con su estado para el lector de pantalla
  const a11y = targetable
    ? pressable(() => onSlot?.(playerId, slot.id), label)
    : { role: 'img', 'aria-label': `${label}${picked ? ', elegido' : ''}` };

  return (
    <div
      className={classes}
      style={{
        width: w, height: h * (1 + STACK_EXTRA), '--w': `${w}px`, '--h': `${h}px`, ...(arrive && { '--arrive-delay': `${arrive.delay}ms` }),
      }}
      data-anchor={slotAnchor(playerId, slot.id)}
      data-drop={targetable ? 'slot' : undefined}
      data-pid={playerId}
      data-slot={slot.id}
      {...a11y}
    >
      <div className="gt-slot-aura" style={{ height: stackH }} />
      {/* Como en el mockup: el órgano al frente y lo que tiene encima asomando por debajo */}
      {mods.map((c, i) => (
        <GameCard
          key={c.id}
          card={c}
          w={w}
          h={h}
          className={`gt-slot-card gt-mod gt-mod-${c.kind}`}
          style={{ top: (i + 1) * STACK_STEP * h, left: (i % 2 ? -1 : 1) * w * 0.03, zIndex: 3 - i, rotate: i % 2 ? -2.5 : 2.5 }}
        />
      ))}
      <GameCard card={slot.organ} w={w} h={h} className="gt-slot-card gt-organ" style={{ top: 0, left: 0, zIndex: 4 }} />
      {/* La carta que golpea (vista intermedia del reproductor de eventos): encima del órgano, ladeada */}
      {slot.incoming && (
        <GameCard
          key={slot.incoming.id}
          card={slot.incoming}
          w={w}
          h={h}
          className="gt-slot-card gt-incoming"
          style={{ top: h * STACK_STEP * 0.6, left: w * 0.12, zIndex: 7, rotate: 8 }}
        />
      )}
      {status === 'immunized' && <div className="gt-slot-shine" style={{ height: stackH }} />}
      {status === 'vaccinated' && <div className="gt-slot-sweep" style={{ height: stackH }} />}
      {status !== 'healthy' && (
        <div className={`gt-slot-badge b-${status}`}>
          {status === 'immunized' ? <ShieldIcon /> : status === 'infected' ? <GermIcon /> : <DropIcon />}
        </div>
      )}
      {(targetable || picked) && <div className="gt-slot-target" style={{ height: stackH }} />}
    </div>
  );
});

// El cuerpo de un jugador: ranuras + huecos vacíos hasta completar 4
export const Body = memo(function Body({
  playerId, body, card4, card5, cols, gap, hl, picked, hover, onSlot, organTarget, onBody, className = '', ownerName, mine = false,
}) {
  const n = body.length;
  const size = n >= 5 || (organTarget && n >= 4) ? card5 : card4;
  const wells = Math.max(0, 4 - n) + (organTarget && n >= 4 ? 1 : 0);
  const grid = cols < 5;
  const items = [
    ...body.map((slot) => {
      const k = slotKey(playerId, slot.id);
      const targetable = !!hl?.slots?.has(k);
      return (
        <BodySlot
          key={slot.id}
          slot={slot}
          playerId={playerId}
          w={size.w}
          h={size.h}
          targetable={targetable}
          picked={picked === k}
          hovered={hover === k}
          dimmed={hl?.active && !targetable && picked !== k}
          onSlot={onSlot}
          ownerName={ownerName}
          mine={mine}
        />
      );
    }),
    ...Array.from({ length: wells }, (_, i) => (
      <div
        key={`well-${i}`}
        className={`gt-well ${organTarget && i === 0 ? 'is-target' : ''} ${organTarget && i === 0 && hover === `body:${playerId}` ? 'is-hover' : ''}`}
        style={{ width: size.w, height: size.h * (1 + STACK_EXTRA) }}
      >
        <div className="gt-well-in" style={{ height: size.h }}>{organTarget && i === 0 && <span>+</span>}</div>
      </div>
    )),
  ];

  return (
    <div
      className={`gt-body ${grid ? 'is-grid' : 'is-row'} ${organTarget ? 'is-target' : ''} ${className}`}
      style={{ gap, gridTemplateColumns: grid ? `repeat(${cols}, ${size.w}px)` : undefined }}
      data-anchor={`body:${playerId}`}
      data-drop={organTarget ? 'body' : undefined}
      data-pid={playerId}
      {...pressable(organTarget ? () => onBody?.(playerId) : null, mine ? 'Ponerte el órgano en tu cuerpo' : `Poner el órgano en el cuerpo de ${ownerName}`)}
    >
      {items}
    </div>
  );
});
