import { memo, useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue } from 'framer-motion';
import { GameCard } from './GameCard';
import { reducedMotion } from './fx';
import { sfx } from '../../lib/sfx';
import { cardLabel } from '../../lib/cards';

const SPRING_BACK = { type: 'spring', stiffness: 420, damping: 30 };
// Reacomodo del abanico: la posición de cada carta es un x/y animado (no la proyección de layout,
// que en un solo frame hacía saltar 100 px a la carta que pasaba a la posición 0). Espera un poco
// para cerrar el hueco, así primero se ve salir la carta jugada.
const FAN_SPRING = { type: 'spring', stiffness: 300, damping: 28, delay: 0.12 };

// Una carta de mi mano: se selecciona con clic o se arrastra hacia un destino.
// Capas: .gt-hand-slot (x/y del abanico, sin giro) → GameCard (giro, arrastre y layoutId para cambiar de
// contenedor). El arrastre va en sus propios x/y dentro de un contenedor sin girar, así sigue al puntero.
const HandCard = memo(function HandCard({
  card, w, h, left, top, baseX, baseY, tilt, index, canDrag, selected, marked, idle, onClick, onDragStart, onDragMove, onDrop,
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const dragging = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const back = () => {
    animate(x, 0, SPRING_BACK);
    animate(y, 0, SPRING_BACK);
  };
  // Mientras se arrastra, su contenedor pasa por encima de las demás cartas
  const [lifted, setLifted] = useState(false);

  // Fuera de turno: un rebote corto en su sitio (en vez de sólo un aviso)
  const bounce = (el) => {
    if (!el || reducedMotion()) return;
    el.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-6px)' }, { transform: 'translateY(0)' }], { duration: 200, easing: 'ease-out' });
  };

  const classes = [
    'gt-hand-card',
    selected && 'is-selected',
    marked && 'is-marked',
    idle && 'is-idle',
  ].filter(Boolean).join(' ');

  return (
    <motion.div
      className="gt-hand-slot"
      style={{ left, top, width: w, height: h, zIndex: lifted ? 90 : selected ? 30 : 10 + index }}
      initial={false}
      animate={{ x: baseX, y: baseY }}
      transition={FAN_SPRING}
    >
      <GameCard
        card={card}
        w={w}
        h={h}
        className={classes}
        style={{ x, y }}
        animate={{ rotate: selected ? 0 : tilt }}
        drag={canDrag}
        dragMomentum={false}
        dragElastic={0.18}
        whileDrag={{ scale: 0.82, rotate: 0, zIndex: 90, cursor: 'grabbing' }}
        onDragStart={() => {
          dragging.current = true;
          setLifted(true);
          onDragStart(card.id);
        }}
        onDrag={(e, info) => onDragMove(info.point)}
        onDragEnd={(e, info) => {
          // Si se soltó sobre un destino válido, se juega; si no (o falla), regresa a la mano
          Promise.resolve(onDrop(card.id, info.point)).then((ok) => {
            if (!ok && alive.current) back();
          });
          setTimeout(() => { dragging.current = false; }, 0);
          setTimeout(() => alive.current && setLifted(false), 400);
        }}
        onClick={(e) => {
          if (dragging.current) return;
          if (idle) bounce(e.currentTarget.querySelector('.gc-fly'));
          onClick(card.id);
        }}
        onMouseEnter={() => !idle && sfx.hover()}
        role="button"
        aria-label={cardLabel(card)}
        aria-pressed={selected || marked}
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(card.id); }
        }}
      >
        {marked && <span className="gt-mark">✕</span>}
      </GameCard>
    </motion.div>
  );
});

// Mi mano en abanico, abajo al centro
export const Hand = memo(function Hand({
  hand, layout, myTurn, selectedId, discardMode, discardIds, onCardClick, onDragStart, onDragMove, onDrop,
}) {
  const { card, cx, top } = layout;
  const n = hand.length;
  const mid = (n - 1) / 2;
  const spacing = card.w * 0.86;

  return (
    <div className={`gt-hand ${myTurn ? 'is-my-turn' : ''} ${discardMode ? 'is-discard' : ''}`} data-anchor="hand:me">
      {hand.map((c, i) => {
        const d = i - mid;
        return (
          <HandCard
            key={c.id}
            card={c}
            index={i}
            w={card.w}
            h={card.h}
            left={cx - card.w / 2}
            top={top}
            baseX={d * spacing}
            baseY={d * d * card.h * 0.045}
            tilt={d * 7}
            canDrag={myTurn && !discardMode}
            selected={selectedId === c.id}
            marked={discardIds.includes(c.id)}
            idle={!myTurn}
            onClick={onCardClick}
            onDragStart={onDragStart}
            onDragMove={onDragMove}
            onDrop={onDrop}
          />
        );
      })}
    </div>
  );
});
