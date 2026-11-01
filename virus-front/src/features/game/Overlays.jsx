import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ---------- Emisores simples (narrador, errores, banner) ----------

const makeBus = () => {
  const subs = new Set();
  return {
    emit: (v) => subs.forEach((fn) => fn(v)),
    on: (fn) => { subs.add(fn); return () => subs.delete(fn); },
  };
};

const narratorBus = makeBus();
const errorBus = makeBus();
const bannerBus = makeBus();

// narrate('Vane le robó el corazón a Elian', { color: '#ff0', tone: 'bad' })
export const narrate = (text, opts = {}) => narratorBus.emit({ text, ...opts });
export const toastError = (text) => errorBus.emit({ text });
export const showBanner = (text, opts = {}) => bannerBus.emit({ text, ...opts });
// Quita el banner en cuanto empieza otra jugada (para que no tape la mesa)
export const hideBanner = () => bannerBus.emit(null);

let seq = 0;

// ---------- Narrador: toasts con lo que va pasando, espaciados ~600 ms ----------

export const Narrator = memo(function Narrator({ style }) {
  const [items, setItems] = useState([]);
  const queue = useRef([]);
  const timer = useRef(null);

  useEffect(() => {
    const pump = () => {
      const next = queue.current.shift();
      if (!next) { timer.current = null; return; }
      const item = { id: ++seq, ...next };
      setItems((list) => [...list, item].slice(-3));
      setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), 4200);
      timer.current = setTimeout(pump, 600);
    };
    const off = narratorBus.on((msg) => {
      queue.current.push(msg);
      if (queue.current.length > 8) queue.current.splice(0, queue.current.length - 8);
      if (!timer.current) pump();
    });
    return () => { off(); clearTimeout(timer.current); timer.current = null; };
  }, []);

  return (
    <div className="gt-narrator" style={style} aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((it) => (
          <motion.div
            key={it.id}
            layout
            className={`gt-toast tone-${it.tone || 'info'}`}
            style={{ '--tc': it.color || '#ffae00' }}
            initial={{ opacity: 0, x: -60, scale: 0.85 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -30, scale: 0.9, transition: { duration: 0.25 } }}
            transition={{ type: 'spring', stiffness: 420, damping: 30 }}
          >
            <span className="gt-toast-dot" />
            <span>{it.text}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

// ---------- Errores (jugada rechazada por el servidor, etc.) ----------

export const ErrorToasts = memo(function ErrorToasts({ style }) {
  const [items, setItems] = useState([]);
  useEffect(() => errorBus.on((msg) => {
    const item = { id: ++seq, ...msg };
    setItems((list) => [...list.slice(-2), item]);
    setTimeout(() => setItems((list) => list.filter((i) => i.id !== item.id)), 3200);
  }), []);
  return (
    <div className="gt-errors" style={style} role="alert">
      <AnimatePresence>
        {items.map((it) => (
          <motion.div
            key={it.id}
            layout
            className="gt-toast tone-error"
            initial={{ opacity: 0, y: 30, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1, x: [0, -8, 8, -5, 5, 0] }}
            exit={{ opacity: 0, y: -10, transition: { duration: 0.2 } }}
            transition={{ duration: 0.45 }}
          >
            {it.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
});

// ---------- Banner "¡Tu turno!" ----------

export const TurnBanner = memo(function TurnBanner() {
  const [banner, setBanner] = useState(null);
  useEffect(() => bannerBus.on((b) => {
    if (!b) { setBanner(null); return; }
    const item = { id: ++seq, ...b };
    setBanner(item);
    setTimeout(() => setBanner((cur) => (cur?.id === item.id ? null : cur)), b.ms || 1000);
  }), []);
  return (
    <AnimatePresence>
      {banner && (
        <motion.div
          key={banner.id}
          className="gt-banner"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
        >
          <div className="gt-banner-rays" />
          <motion.div
            className="gt-banner-text"
            initial={{ scale: 0.2, rotate: -14, y: 40 }}
            animate={{ scale: [0.2, 1.18, 1], rotate: [-14, 4, -2], y: 0 }}
            exit={{ scale: 1.6, opacity: 0, transition: { duration: 0.3 } }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          >
            {banner.text}
            {banner.sub && <small>{banner.sub}</small>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});
