import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { slotStatus } from '@shared/engine/index.js';
import { COLOR_HEX, COLOR_NAMES, cardHelp, cardLabel } from '../../lib/cards';
import '../emotes/emotes.css';

// Cuánto hay que dejar el puntero encima (o el dedo presionado) para que salga la ayuda
const HOVER_MS = 550;
const PRESS_MS = 450;
const TIP_W = 290;

const STATUS_LABEL = { healthy: 'sano', infected: 'infectado', vaccinated: 'vacunado', immunized: 'inmune (ya nada le afecta)' };
const safeStatus = (slot) => {
  try { return slotStatus(slot); } catch { return 'healthy'; }
};

// Todas las cartas boca arriba de la mesa por id, con dónde están
const indexCards = (view, me) => {
  const map = new Map();
  if (!view) return map;
  for (const c of view.hand || []) map.set(c.id, { card: c });
  for (const p of view.players || []) {
    for (const slot of p.body || []) {
      const where = { slot, owner: p.id === me ? null : p.name };
      if (slot.organ) map.set(slot.organ.id, { card: slot.organ, ...where, isOrgan: true });
      for (const c of [...(slot.viruses || []), ...(slot.medicines || [])]) map.set(c.id, { card: c, ...where });
    }
  }
  if (view.discardTop) map.set(view.discardTop.id, { card: view.discardTop, discard: true });
  return map;
};

// "tu corazón" / "el cerebro de Beto"
const organOf = (slot, owner) => {
  const organ = COLOR_NAMES[slot.organ?.color] || 'órgano';
  return owner ? `el ${organ} de ${owner}` : `tu ${organ}`;
};

const extraLine = (entry) => {
  if (entry.discard) return 'Última carta del descarte';
  if (!entry.slot) return null;
  const status = STATUS_LABEL[safeStatus(entry.slot)];
  if (entry.isOrgan) return `${entry.owner ? `De ${entry.owner}` : 'Tuyo'}: ${status}`;
  return `Está sobre ${organOf(entry.slot, entry.owner)}`;
};

// Ayuda de cualquier carta boca arriba: con el ratón, dejándolo encima un momento; en pantallas
// táctiles, manteniéndola presionada (y entonces el toque no cuenta como clic).
export const CardTip = memo(function CardTip({ view, me }) {
  const index = useMemo(() => indexCards(view, me), [view, me]);
  const indexRef = useRef(index);
  indexRef.current = index;
  const [tip, setTip] = useState(null); // { id, rect }

  useEffect(() => {
    let timer = null;
    let hideTimer = null;
    let el = null;
    let start = null;
    let pressed = false;
    const clear = () => { clearTimeout(timer); timer = null; };
    const hide = () => {
      clear();
      clearTimeout(hideTimer);
      el = null;
      start = null;
      pressed = false;
      setTip(null);
    };
    const show = (target) => {
      const id = target.dataset.cardId;
      if (!indexRef.current.has(id) || !target.isConnected) return false;
      setTip({ id, rect: target.getBoundingClientRect() });
      return true;
    };
    const cardAt = (target) => target?.closest?.('.gt-root [data-card-id]') || null;

    const over = (e) => {
      if (e.pointerType === 'touch') return;
      const t = cardAt(e.target);
      if (t === el) return;
      hide();
      if (!t || e.buttons) return;
      el = t;
      timer = setTimeout(() => show(t), HOVER_MS);
    };
    const out = (e) => { if (!e.relatedTarget && e.pointerType !== 'touch') hide(); };
    const down = (e) => {
      hide();
      if (e.pointerType !== 'touch') return;
      const t = cardAt(e.target);
      if (!t) return;
      el = t;
      start = { x: e.clientX, y: e.clientY };
      timer = setTimeout(() => { pressed = show(t); }, PRESS_MS);
    };
    const move = (e) => {
      if (e.pointerType === 'touch' && start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) {
        start = null;
        pressed = false;
        hide();
      }
    };
    const up = (e) => {
      if (e.pointerType !== 'touch') return;
      const wasPressed = pressed;
      start = null;
      pressed = false;
      clear();
      if (!wasPressed) return;
      // El clic que llega al soltar no debe seleccionar la carta
      const block = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      window.addEventListener('click', block, { capture: true, once: true });
      setTimeout(() => window.removeEventListener('click', block, true), 400);
      hideTimer = setTimeout(hide, 2200);
    };
    // Mantener presionada una carta no debe abrir el menú del navegador
    const menu = (e) => { if (cardAt(e.target)) e.preventDefault(); };

    window.addEventListener('pointerover', over);
    window.addEventListener('pointerout', out);
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', hide, true);
    window.addEventListener('contextmenu', menu);
    window.addEventListener('wheel', hide, { passive: true });
    window.addEventListener('blur', hide);
    return () => {
      hide();
      window.removeEventListener('pointerover', over);
      window.removeEventListener('pointerout', out);
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', hide, true);
      window.removeEventListener('contextmenu', menu);
      window.removeEventListener('wheel', hide);
      window.removeEventListener('blur', hide);
    };
  }, []);

  // Si la carta deja de estar en la mesa (se jugó, se destruyó…), la ayuda se va con ella
  const entry = tip ? index.get(tip.id) : null;
  useEffect(() => { if (tip && !entry) setTip(null); }, [tip, entry]);

  let pos = null;
  if (tip && entry) {
    const { rect } = tip;
    const vw = window.innerWidth;
    const left = Math.max(8, Math.min(vw - TIP_W - 8, rect.left + rect.width / 2 - TIP_W / 2));
    const above = rect.top > 190;
    pos = above
      ? { left, top: rect.top - 10, translateY: '-100%' }
      : { left, top: Math.min(window.innerHeight - 160, rect.bottom + 10), translateY: '0%' };
  }
  const card = entry?.card;
  const extra = entry ? extraLine(entry) : null;

  return (
    <AnimatePresence>
      {pos && card && (
        <motion.div
          key={tip.id}
          className="card-tip"
          role="tooltip"
          style={{ left: pos.left, top: pos.top, '--tc': COLOR_HEX[card.color] || '#885ffe' }}
          initial={{ opacity: 0, y: pos.translateY === '0%' ? -6 : 6, translateY: pos.translateY, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, translateY: pos.translateY, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.1 } }}
          transition={{ type: 'spring', stiffness: 600, damping: 34 }}
        >
          <strong>{cardLabel(card)}</strong>
          <span>{cardHelp(card)}</span>
          {extra && <em>{extra}</em>}
        </motion.div>
      )}
    </AnimatePresence>
  );
});
