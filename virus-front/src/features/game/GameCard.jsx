import { forwardRef, memo, useLayoutEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { BACK_IMAGE, cardImage, cardLabel } from '../../lib/cards';
import { peekFlight, playOrigin, reducedMotion, takeFlight } from './fx';

// Transición de las cartas cuando cambian de contenedor (mano → ranura → descarte…)
export const CARD_LAYOUT_TRANSITION = { type: 'spring', stiffness: 260, damping: 26, mass: 0.9 };

// Vuelo de intercambio (registrado con setFlight): tween con su retraso y un arco hacia un lado
const FLIGHT_EASE = [0.4, 0, 0.2, 1]; // despega suave para que se lea de dónde sale (la de la especificación, 0.22,1,0.36,1, saltaba 100 px el primer frame)
const flightTransition = (f) => ({ type: 'tween', duration: f.duration / 1000, ease: FLIGHT_EASE, delay: (f.delay || 0) / 1000 });

// El arco va en .gc-fly (el layout de framer mueve el contenedor de afuera en línea recta)
const playFlightArc = (f, flyEl) => {
  if (!f || !flyEl || reducedMotion()) return;
  const arcX = f.arc || 0;
  flyEl.animate(
    [
      { transform: 'none', filter: 'none' },
      { transform: `translate(${arcX}px, -40px) scale(1.08)`, filter: 'drop-shadow(0 14px 16px rgba(20, 5, 70, 0.5))', offset: 0.5 },
      { transform: 'none', filter: 'none' },
    ],
    { duration: f.duration, delay: f.delay || 0, easing: 'ease-in-out' },
  );
};

// Sube una carta por encima de todo mientras vuela, guardando su z-index propio para devolvérselo
const lift = (el, on) => {
  if (!el) return;
  if (on) {
    if (el.dataset.z === undefined) el.dataset.z = el.style.zIndex;
    el.style.zIndex = 60;
  } else if (el.dataset.z !== undefined) {
    el.style.zIndex = el.dataset.z;
    delete el.dataset.z;
  }
};

// Carta de la mesa. Capas:
//   motion.div (layoutId = card.id: vuela sola entre contenedores)
//     .gc-fly   (WAAPI: llegada desde un avatar o el mazo, temblores)
//       .gc-lift (CSS: levantarse al pasar el ratón / al seleccionarla)
//         .gc-flip (volteo 3D: frente y reverso)
const GameCardBase = forwardRef(function GameCard(
  {
    card, w, h, faceDown = false, fxKey, className = '', style, children, layoutId, noLayout = false,
    onLayoutAnimationStart, onLayoutAnimationComplete, ...rest
  },
  outerRef,
) {
  const flyRef = useRef(null);
  const flipRef = useRef(null);
  const elRef = useRef(null);
  const key = fxKey || card?.id;

  // Vuelo de intercambio registrado para esta carta: se lee al montarse en su nuevo sitio y se conserva
  // mientras dura. Si se leyera en cada render, cualquier render entre el montaje y el arranque del vuelo
  // (framer lo arranca un frame después) cambiaría la transición por el resorte: sin retraso ni ritmo propio.
  const flightRef = useRef(undefined);
  if (flightRef.current === undefined) {
    const f = noLayout ? null : peekFlight(key);
    flightRef.current = f ? { f, until: Date.now() + (f.delay || 0) + f.duration + 200 } : null;
  }
  const flight = flightRef.current && Date.now() < flightRef.current.until ? flightRef.current.f : null;

  // Si el reproductor de eventos registró un origen para esta carta, llega volando desde ahí
  useLayoutEffect(() => {
    const ms = playOrigin(key, flyRef.current, flipRef.current);
    const f = noLayout ? null : takeFlight(key);
    if (f) playFlightArc(f, flyRef.current);
    // Mientras llega volando, que pase por encima de las demás cartas
    if (!ms || !elRef.current) return undefined;
    const el = elRef.current;
    lift(el, true);
    const t = setTimeout(() => lift(el, false), ms);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const setRefs = (el) => {
    elRef.current = el;
    if (typeof outerRef === 'function') outerRef(el);
    else if (outerRef) outerRef.current = el;
  };

  // Mientras vuela por un cambio de layout, que pase por encima de todo (y luego vuelve a su z-index)
  const raise = () => {
    lift(elRef.current, true);
    onLayoutAnimationStart?.();
  };
  const lower = () => {
    lift(elRef.current, false);
    onLayoutAnimationComplete?.();
  };

  const id = layoutId !== undefined ? layoutId : (!faceDown && card ? card.id : undefined);
  const front = faceDown ? BACK_IMAGE : cardImage(card, 'sm');

  return (
    <motion.div
      ref={setRefs}
      layoutId={noLayout ? undefined : id}
      layout={noLayout ? false : true}
      transition={flight ? flightTransition(flight) : CARD_LAYOUT_TRANSITION}
      onLayoutAnimationStart={raise}
      onLayoutAnimationComplete={lower}
      className={`gc ${className}`}
      style={{ width: w, height: h, ...style }}
      data-card-id={!faceDown && card ? card.id : undefined}
      data-fx-key={key}
      {...rest}
    >
      <div className="gc-fly" ref={flyRef}>
        <div className="gc-lift">
          <div className="gc-flip" ref={flipRef}>
            <img className="gc-face gc-front" src={front} alt={faceDown ? 'Carta boca abajo' : cardLabel(card)} draggable={false} />
            <img className="gc-face gc-back" src={BACK_IMAGE} alt="" draggable={false} />
          </div>
          {children}
        </div>
      </div>
    </motion.div>
  );
});

export const GameCard = memo(GameCardBase);

// Reverso simple sin layoutId (manos de los rivales, mazo)
export const CardBack = memo(function CardBack({ w, h, fxKey, className = '', style, ...rest }) {
  const flyRef = useRef(null);
  useLayoutEffect(() => {
    playOrigin(fxKey, flyRef.current, null);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={`gc gc-plain ${className}`} style={{ width: w, height: h, ...style }} data-fx-key={fxKey} {...rest}>
      <div className="gc-fly" ref={flyRef}>
        <img className="gc-face gc-front" src={BACK_IMAGE} alt="" draggable={false} />
      </div>
    </div>
  );
});
