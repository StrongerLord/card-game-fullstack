import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { EMOTES, EMOTE_KEYS } from '@shared/emotes.js';
import { useStore } from '../../store/useStore';
import './emotes.css';

const typing = (el) => el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);

// Manda un emote; si el servidor lo frena por spam, se ignora en silencio
export const useSendEmote = () => useCallback((key) => {
  useStore.getState().sendEmote(key).catch(() => {});
}, []);

// Atajos 1–8 para mandar emotes sin abrir nada (no mientras se escribe en el chat)
export const useEmoteHotkeys = (enabled = true) => {
  const send = useSendEmote();
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || typing(document.activeElement)) return;
      const i = Number(e.key) - 1;
      if (Number.isInteger(i) && i >= 0 && i < EMOTE_KEYS.length) send(EMOTE_KEYS[i]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, send]);
};

const SmileIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.4" />
    <circle cx="9" cy="10" r="1.4" fill="currentColor" />
    <circle cx="15" cy="10" r="1.4" fill="currentColor" />
    <path d="M8 14.2c2.2 2.4 5.8 2.4 8 0" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

// Fila de emotes (la usa el lobby tal cual y la mesa dentro de un globo)
export const EmoteRow = memo(function EmoteRow({ onSent, className = '' }) {
  const send = useSendEmote();
  return (
    <div className={`emote-row ${className}`} role="group" aria-label="Emotes rápidos">
      {EMOTE_KEYS.map((key, i) => (
        <motion.button
          key={key}
          type="button"
          className="emote-btn"
          title={`Atajo: ${i + 1}`}
          aria-label={`Mandar ${EMOTES[key]}`}
          whileHover={{ scale: 1.25, rotate: i % 2 ? 8 : -8 }}
          whileTap={{ scale: 0.8 }}
          onClick={() => { send(key); onSent?.(key); }}
        >
          {EMOTES[key]}
        </motion.button>
      ))}
    </div>
  );
});

// Botón de la mesa: abre los emotes hacia arriba
export const EmotePicker = memo(function EmotePicker({ buttonClassName = '' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEmoteHotkeys();
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="emote-picker" ref={ref}>
      <button
        type="button"
        className={`${buttonClassName} ${open ? 'is-on' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label="Emotes rápidos"
        aria-expanded={open}
        title="Emotes (teclas 1–8)"
      >
        <SmileIcon />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="emote-pop"
            initial={{ opacity: 0, y: 14, scale: 0.8 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.85, transition: { duration: 0.12 } }}
            transition={{ type: 'spring', stiffness: 520, damping: 30 }}
          >
            <EmoteRow onSent={() => setOpen(false)} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
