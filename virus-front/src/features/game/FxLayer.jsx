import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { onFx } from './fx';
import { CrownIcon } from './CrownIcon';
import { BACK_IMAGE, cardImage, cardLabel, TREATMENT_HELP } from '../../lib/cards';

// Vida de cada efecto en la capa (ms, sin contar su delay); fx.duration la reemplaza si viene
const DURATION = {
  explosion: 1100, sparkles: 1200, glint: 900, goldWave: 1600, puff: 1000, trail: 1000, flyCard: 500, reveal: 950, shuffle: 1000,
  turnPass: 450, stamp: 1000, crownDrop: 2300, swapArc: 800,
};

const rand = (a, b) => a + Math.random() * (b - a);

// Partículas que salen disparadas desde un punto. Los valores al azar se sortean UNA vez por efecto:
// si se recalcularan en cada render, cada efecto nuevo de la capa haría saltar a las partículas en vuelo.
const Burst = memo(function Burst({ x, y, n, colors, dist, size, cls, spread = 360, up = 0 }) {
  const parts = useMemo(() => Array.from({ length: n }, (_, i) => {
    const ang = ((spread === 360 ? (i / n) * 360 : -90 - spread / 2 + (i / n) * spread) + rand(-12, 12)) * (Math.PI / 180);
    const d = dist * rand(0.55, 1.15);
    return {
      width: size * rand(0.6, 1.3),
      height: size * rand(0.6, 1.3),
      dx: Math.cos(ang) * d,
      dy: Math.sin(ang) * d - up,
      r: rand(-260, 260),
      delay: rand(0, 90),
    };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  return parts.map((p, i) => (
    <span
      key={i}
      className={`fx-p ${cls}`}
      style={{
        left: x,
        top: y,
        width: p.width,
        height: p.height,
        background: colors[i % colors.length],
        '--dx': `${p.dx}px`,
        '--dy': `${p.dy}px`,
        '--r': `${p.r}deg`,
        animationDelay: `${p.delay}ms`,
      }}
    />
  ));
});

const Explosion = ({ x, y, w = 80, color = '#ff4d4d' }) => (
  <>
    <span className="fx-flash" style={{ left: x, top: y, width: w * 2.2, height: w * 2.2 }} />
    <span className="fx-ring fx-ring-boom" style={{ left: x, top: y, width: w * 0.6, height: w * 0.6, borderColor: color }} />
    <Burst x={x} y={y} n={26} colors={[color, '#fff', '#ffae00', '#653FD3', color]} dist={w * 1.9} size={w * 0.16} cls="fx-burst" />
    <Burst x={x} y={y} n={8} colors={['#3a2380', '#2b1a66']} dist={w * 1.3} size={w * 0.32} cls="fx-debris" />
  </>
);

const Sparkles = ({ x, y, w = 80, colors = ['#fff', '#ffe066', '#9dffb0'] }) => (
  <>
    <span className="fx-ring fx-ring-soft" style={{ left: x, top: y, width: w, height: w, borderColor: '#9dffb0' }} />
    <Burst x={x} y={y} n={16} colors={colors} dist={w * 1.1} size={w * 0.2} cls="fx-star" up={w * 0.3} />
  </>
);

// color: anillo de otro color (p. ej. el del jugador en un trasplante)
const Glint = ({ x, y, w = 80, color = '#7fe9ff' }) => (
  <>
    <span className="fx-ring fx-ring-soft" style={{ left: x, top: y, width: w * 0.8, height: w * 0.8, borderColor: color }} />
    <Burst x={x} y={y} n={10} colors={[color, '#fff']} dist={w * 0.8} size={w * 0.16} cls="fx-star" up={w * 0.15} />
  </>
);

const GoldWave = ({ x, y, w = 80 }) => (
  <>
    {[0, 1, 2].map((i) => (
      <span key={i} className="fx-ring fx-ring-gold" style={{ left: x, top: y, width: w, height: w, animationDelay: `${i * 170}ms` }} />
    ))}
    <span className="fx-flash fx-flash-gold" style={{ left: x, top: y, width: w * 2, height: w * 2 }} />
    <Burst x={x} y={y} n={22} colors={['#ffd34d', '#fff3b0', '#ffae00', '#fff']} dist={w * 1.6} size={w * 0.18} cls="fx-star" />
  </>
);

const Puff = ({ x, y, w = 80 }) => (
  <>
    <Burst x={x} y={y} n={12} colors={['#8cff4d', '#4fd11f', '#c6ff8a', '#2f8f12']} dist={w * 0.75} size={w * 0.3} cls="fx-blob" up={w * 0.25} />
    <Burst x={x} y={y} n={8} colors={['#b7ff7a']} dist={w * 1.1} size={w * 0.1} cls="fx-bubble" up={w * 0.6} spread={120} />
  </>
);

// Un virus "salta" de un cuerpo a otro (contagio). Va a la par del vuelo de la carta (duration, delay)
const Trail = ({ from, to, w = 60, duration = 750, delay = 0 }) => {
  const d = duration / 1000;
  const dl = delay / 1000;
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - Math.max(60, Math.abs(from.x - to.x) * 0.25);
  return (
    <>
      <motion.span
        className="fx-germ"
        style={{ left: 0, top: 0, width: w * 0.5, height: w * 0.5, marginLeft: -w * 0.25, marginTop: -w * 0.25 }}
        initial={{ x: from.x, y: from.y, scale: 0.4, opacity: 0 }}
        animate={{ x: [from.x, midX, to.x], y: [from.y, midY, to.y], scale: [0.4, 1.3, 0.8], rotate: [0, 360, 720], opacity: [1, 1, 0] }}
        transition={{ duration: d, delay: dl, ease: 'easeInOut' }}
      />
      {[1, 2, 3, 4].map((i) => (
        <motion.span
          key={i}
          className="fx-germ fx-germ-tail"
          style={{ left: 0, top: 0, width: w * (0.42 - i * 0.07), height: w * (0.42 - i * 0.07), marginLeft: -w * (0.21 - i * 0.035), marginTop: -w * (0.21 - i * 0.035) }}
          initial={{ x: from.x, y: from.y, opacity: 0 }}
          animate={{ x: [from.x, midX, to.x], y: [from.y, midY, to.y], opacity: [0, 0.8, 0] }}
          transition={{ duration: d, ease: 'easeInOut', delay: dl + i * 0.05 }}
        />
      ))}
    </>
  );
};

// Una carta que viaja de un punto a otro (manos al descarte, robos de los rivales, rebarajeo…).
// Durante su delay se queda quieta y visible en su origen (reemplaza a la carta real en el mismo frame),
// gira desde su ángulo real hasta el del destino y se funde sólo en los últimos 60 ms, ya posada.
// flipMid: empieza boca arriba y se voltea a medio camino (la de arriba del descarte al rebarajar)
const FLY_EASE = [0.3, 0.7, 0.3, 1];
const FlyCard = ({
  from, to, w, h, card, faceDown, delay = 0, rotate = 0, toRotate, duration = 480, toScale = 1, flipMid = false,
}) => {
  const d = duration / 1000;
  const dl = delay / 1000;
  const fadeAt = Math.max(0.5, 1 - 60 / duration);
  const apex = Math.min(from.y, to.y) - 30;
  const face = faceDown || !card ? BACK_IMAGE : cardImage(card, 'sm');
  return (
    <motion.div
      className="fx-card"
      style={{ left: 0, top: 0, width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2 }}
      initial={{ x: from.x, y: from.y, rotate, scale: 1, opacity: 1 }}
      animate={{
        x: to.x,
        y: [from.y, apex, to.y],
        rotate: toRotate ?? rotate,
        scale: [1, 1.04, toScale],
        opacity: [1, 1, 0],
      }}
      transition={{
        x: { duration: d, delay: dl, ease: FLY_EASE },
        y: { duration: d, delay: dl, times: [0, 0.45, 1], ease: ['easeOut', 'easeIn'] },
        rotate: { duration: d, delay: dl, ease: FLY_EASE },
        scale: { duration: d, delay: dl, times: [0, 0.5, 1] },
        opacity: { duration: d, delay: dl, times: [0, fadeAt, 1], ease: 'linear' },
      }}
    >
      {flipMid ? (
        <motion.div
          className="fx-card-flip"
          initial={{ rotateY: 0 }}
          animate={{ rotateY: 180 }}
          transition={{ duration: d * 0.4, delay: dl + d * 0.3, ease: 'easeInOut' }}
        >
          <img className="fx-card-face" src={face} alt="" />
          <img className="fx-card-face fx-card-back" src={BACK_IMAGE} alt="" />
        </motion.div>
      ) : <img className="fx-card-face" src={face} alt="" />}
    </motion.div>
  );
};

// Carta grande al centro cuando un rival juega un tratamiento. Entra, se sostiene para leerla y al
// final no se desvanece en su sitio: vuela al descarte (to) y se encoge hasta el tamaño de la carta de allá.
const Reveal = ({ card, who, to, toW, duration = 950 }) => {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !to) return;
    const img = el.querySelector('img');
    const r = (img || el).getBoundingClientRect();
    const dx = to.x - (r.left + r.width / 2);
    const dy = to.y - (r.top + r.height / 2);
    const s = toW && r.width ? Math.max(0.2, Math.min(0.6, toW / r.width)) : 0.35;
    el.animate(
      [
        { transform: 'none', opacity: 1 },
        { transform: 'none', opacity: 1, offset: 0.6 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 1, offset: 0.95 },
        { transform: `translate(${dx}px, ${dy}px) scale(${s})`, opacity: 0 },
      ],
      { duration, easing: 'cubic-bezier(.45,0,.3,1)', fill: 'forwards' },
    );
    el.querySelector('.fx-reveal-label')?.animate(
      [{ opacity: 1 }, { opacity: 1, offset: 0.55 }, { opacity: 0, offset: 0.68 }, { opacity: 0 }],
      { duration, fill: 'forwards' },
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const d = duration / 1000;
  return (
    <div className="fx-reveal" ref={ref}>
      <motion.div
        className="fx-reveal-in"
        initial={{ scale: 0.3, opacity: 0, rotate: -18, y: 40 }}
        animate={to
          ? { scale: [0.3, 1.08, 1], opacity: [0, 1, 1], rotate: [-18, 4, 0], y: [40, 0, 0] }
          : { scale: [0.3, 1.08, 1, 1, 0.8], opacity: [0, 1, 1, 1, 0], rotate: [-18, 4, 0, 0, 8], y: [40, 0, 0, 0, -30] }}
        transition={to ? { duration: d * 0.34, times: [0, 0.65, 1] } : { duration: d, times: [0, 0.22, 0.32, 0.8, 1] }}
      >
        <img src={cardImage(card, 'big')} alt="" />
        <div className="fx-reveal-label">
          {who && <small>{who}</small>}
          <strong>{cardLabel(card)}</strong>
          {card.kind === 'treatment' && <span>{TREATMENT_HELP[card.treatment]}</span>}
        </div>
      </motion.div>
    </div>
  );
};

// Barajeo: reversos que giran alrededor del mazo
const Shuffle = ({ x, y, w, h }) =>
  [0, 1, 2, 3].map((i) => (
    <motion.img
      key={i}
      className="fx-card"
      src={BACK_IMAGE}
      alt=""
      style={{ left: x - w / 2, top: y - h / 2, width: w, height: h }}
      animate={{ x: [0, (i % 2 ? 1 : -1) * w * 0.9, 0], rotate: [0, (i % 2 ? 1 : -1) * 25, 0], y: [0, -10 * i, 0] }}
      transition={{ duration: 0.8, delay: i * 0.06, ease: 'easeInOut' }}
    />
  ));

// Ficha del color del jugador que pasa de un avatar al siguiente al cambiar el turno
const TurnPass = ({ from, to, color = '#ffae00', duration = 350 }) => {
  const d = duration / 1000;
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) - Math.max(40, Math.abs(from.x - to.x) * 0.18);
  return [0, 1, 2].map((i) => {
    const size = 22 - i * 5;
    return (
      <motion.span
        key={i}
        className={`fx-chip ${i ? 'fx-chip-tail' : ''}`}
        style={{ left: 0, top: 0, '--cc': color, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
        initial={{ x: from.x, y: from.y, opacity: 0, scale: 0.6 }}
        animate={{ x: [from.x, midX, to.x], y: [from.y, midY, to.y], opacity: i ? [0, 0.7, 0] : [1, 1, 0], scale: i ? 1 : [0.6, 1.2, 1.6] }}
        transition={{ duration: d, delay: i * 0.04, ease: 'easeInOut' }}
      />
    );
  });
};

// Sello sobre un avatar ("PIERDE TURNO", o un reloj cuando se le acabó el tiempo)
const Stamp = ({ x, y, text, clock = false, duration = 1000 }) => (
  <motion.div
    className={`fx-stamp ${clock ? 'is-clock' : ''}`}
    style={{ left: x, top: y }}
    initial={{ scale: 1.6, rotate: -12, opacity: 0 }}
    animate={{ scale: 1, rotate: -12, opacity: [0, 1, 1, 0] }}
    transition={{
      scale: { type: 'spring', stiffness: 520, damping: 16 },
      opacity: { duration: duration / 1000, times: [0, 0.1, 0.75, 1] },
    }}
  >
    {clock ? (
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="12" cy="13" r="8.5" fill="#fff" stroke="currentColor" strokeWidth="2.4" />
        <path d="M12 8.5V13l3 2" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
        <path d="M9 2.5h6" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    ) : text}
  </motion.div>
);

// Corona que cae sobre el avatar del ganador
const CROWN_SPRING = { type: 'spring', stiffness: 300, damping: 12 };
const CrownDrop = ({ x, y, w = 60 }) => (
  <motion.div
    className="fx-crown"
    style={{ left: x, top: y, width: w, height: w, marginLeft: -w / 2, marginTop: -w / 2 }}
    initial={{ y: -60, rotate: -20, opacity: 0, scale: 0.8 }}
    animate={{ y: 0, rotate: 0, opacity: [0, 1, 1, 1, 0], scale: 1 }}
    transition={{ y: CROWN_SPRING, rotate: CROWN_SPRING, scale: CROWN_SPRING, opacity: { duration: 2.2, times: [0, 0.08, 0.5, 0.85, 1] } }}
  >
    <CrownIcon size="100%" />
  </motion.div>
);

// Error médico: dos estelas del color de cada jugador que se cruzan entre los cuerpos (van con las cartas)
const SwapArc = ({ from, to, colorA = '#ffae00', colorB = '#a24bff', duration = 700 }) => {
  const d = duration / 1000;
  const lift = Math.max(50, Math.abs(from.x - to.x) * 0.2);
  const sides = [[from, to, colorA, 1], [to, from, colorB, -1]];
  return sides.map(([a, b, color, sign]) => [0, 1, 2, 3].map((i) => {
    const size = 26 - i * 5;
    return (
      <motion.span
        key={`${sign}-${i}`}
        className={`fx-chip ${i ? 'fx-chip-tail' : ''}`}
        style={{ left: 0, top: 0, '--cc': color, width: size, height: size, marginLeft: -size / 2, marginTop: -size / 2 }}
        initial={{ x: a.x, y: a.y, opacity: 0 }}
        animate={{
          x: [a.x, (a.x + b.x) / 2 + sign * 30, b.x],
          y: [a.y, (a.y + b.y) / 2 - sign * lift, b.y],
          opacity: i ? [0, 0.6, 0] : [0.9, 1, 0],
        }}
        transition={{ duration: d, delay: i * 0.05, ease: [0.22, 1, 0.36, 1] }}
      />
    );
  }));
};

// Memoizados: los props de cada efecto no cambian, así que uno nuevo no vuelve a pintar los que ya vuelan
const RENDER = Object.fromEntries(Object.entries({
  explosion: Explosion, sparkles: Sparkles, glint: Glint, goldWave: GoldWave, puff: Puff, trail: Trail,
  flyCard: FlyCard, reveal: Reveal, shuffle: Shuffle, turnPass: TurnPass, stamp: Stamp, crownDrop: CrownDrop, swapArc: SwapArc,
}).map(([kind, C]) => [kind, memo(C)]));

// Capa de efectos encima de la mesa (no recibe clics)
export const FxLayer = memo(function FxLayer() {
  const [items, setItems] = useState([]);
  useEffect(() => onFx((fx) => {
    setItems((list) => [...list.slice(-60), fx]);
    const ttl = (fx.duration || DURATION[fx.kind] || 1000) + (fx.delay || 0) + 100;
    setTimeout(() => setItems((list) => list.filter((f) => f.id !== fx.id)), ttl);
  }), []);

  return (
    <div className="fx-layer" aria-hidden>
      {items.map((fx) => {
        const C = RENDER[fx.kind];
        return C ? <C key={fx.id} {...fx} /> : null;
      })}
    </div>
  );
});
