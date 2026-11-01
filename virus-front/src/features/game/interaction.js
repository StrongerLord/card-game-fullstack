// Estado de la interacción con la mesa: carta seleccionada, destinos legales,
// trasplante en dos pasos, modo descartar, arrastrar y soltar.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getLegalTargets } from '@shared/engine/index.js';
import { useStore } from '../../store/useStore';
import { sfx } from '../../lib/sfx';
import { slotKey } from './Body';
import { shake, anchorRect } from './fx';
import { toastError } from './Overlays';

const same = (a, b) => a && b && a.playerId === b.playerId && a.slotId === b.slotId;

// Instrucción (qué hacer ahora) que se muestra junto al nombre de la carta seleccionada.
// La descripción del tratamiento (TREATMENT_HELP) va en la revelación y en "Cómo jugar", no aquí.
const HINTS = {
  organ: 'Haz clic en tu cuerpo (o arrástrala ahí) para ponerte el órgano',
  virus: 'Elige un órgano compatible para pegarle la roña',
  medicine: 'Elige uno de tus órganos para curarlo o vacunarlo',
  thief: 'Elige el órgano que quieres robar',
  transplant: 'Elige el primer órgano del intercambio',
  transplant2: 'Ahora elige el órgano de otro jugador',
  contagion: 'Usa el botón Contagiar o suéltala en la mesa para pasar tus roñas',
  glove: 'Usa el botón Usar guante o suéltala en la mesa',
  medicalError: 'Elige con quién cambiar tu cuerpo completo',
};

export const useInteraction = ({ view, me }) => {
  const [selectedId, setSelectedId] = useState(null);
  const [first, setFirst] = useState(null); // primera ranura del trasplante
  const [discardMode, setDiscardMode] = useState(false);
  const [discardIds, setDiscardIds] = useState([]);
  const [confirmGlove, setConfirmGlove] = useState(false);
  const [pending, setPending] = useState(false);
  const [hover, setHover] = useState(null); // destino bajo el cursor al arrastrar
  const pendingRef = useRef(false);
  const [dragging, setDragging] = useState(false); // hay una carta en el aire
  // Avisos suaves y pasajeros (no son errores): { text, kind: 'hint' | 'toast' }
  // 'hint' reemplaza un momento el texto de la pista; 'toast' es una burbuja neutra junto a la mano
  const [nudge, setNudge] = useState(null);
  const nudgeTimer = useRef(null);
  const showNudge = useCallback((text, kind, ms) => {
    clearTimeout(nudgeTimer.current);
    setNudge({ text, kind, id: Date.now() });
    nudgeTimer.current = setTimeout(() => setNudge(null), ms);
  }, []);
  useEffect(() => () => clearTimeout(nudgeTimer.current), []);

  // Mientras se anima un lote (el mío, sobre todo) la vista conserva el turno viejo: la mesa no acepta
  // jugadas hasta que la animación termina (el servidor ya pasó el turno y las rechazaría).
  const animating = useStore((s) => s.eventQueue.length > 0) || !!view?.animating;
  const turnIsMine = !!view && view.turnPlayerId === me && !view.winner;
  const myTurn = turnIsMine && !animating;
  // Mi jugada se está animando (para la pista y para que la mano no baje y vuelva a subir en vertical)
  const playing = turnIsMine && animating;
  const card = (selectedId && view?.hand?.find((c) => c.id === selectedId)) || null;
  const mode = card ? (card.kind === 'treatment' ? card.treatment : card.kind) : null;

  const reset = useCallback(() => {
    setSelectedId(null);
    setFirst(null);
    setConfirmGlove(false);
    setHover(null);
    setDragging(false);
  }, []);

  const cancelAll = useCallback(() => {
    reset();
    setDiscardMode(false);
    setDiscardIds([]);
  }, [reset]);

  // Si la carta se fue de la mano o dejó de ser mi turno, se limpia todo
  useEffect(() => {
    if (selectedId && (!card || !myTurn)) reset();
  }, [selectedId, card, myTurn, reset]);
  useEffect(() => {
    if (!myTurn) { setDiscardMode(false); setDiscardIds([]); }
  }, [myTurn]);
  useEffect(() => {
    setDiscardIds((ids) => ids.filter((id) => view?.hand?.some((c) => c.id === id)));
  }, [view?.hand]);

  const targets = useMemo(() => {
    if (!card || !myTurn) return [];
    try {
      return getLegalTargets(view, me, card.id) || [];
    } catch (err) {
      console.warn('[mesa] getLegalTargets falló', err);
      return [];
    }
  }, [view, me, card, myTurn]);

  // Qué se resalta en la mesa
  const hl = useMemo(() => {
    const slots = new Set();
    const bodies = new Set();
    const players = new Set();
    if (card) {
      if (mode === 'organ') targets.forEach((t) => bodies.add(t.playerId));
      else if (mode === 'virus' || mode === 'medicine' || mode === 'thief') targets.forEach((t) => slots.add(slotKey(t.playerId, t.slotId)));
      else if (mode === 'transplant') {
        targets.forEach((t) => {
          if (!first) {
            slots.add(slotKey(t.a.playerId, t.a.slotId));
            slots.add(slotKey(t.b.playerId, t.b.slotId));
          } else if (same(t.a, first)) slots.add(slotKey(t.b.playerId, t.b.slotId));
          else if (same(t.b, first)) slots.add(slotKey(t.a.playerId, t.a.slotId));
        });
      } else if (mode === 'medicalError') targets.forEach((t) => players.add(t.playerId));
    }
    return { slots, bodies, players, active: !!card && (slots.size + bodies.size + players.size > 0 || mode === 'transplant') };
  }, [card, mode, targets, first]);

  const tableTarget = !!card && (mode === 'contagion' || mode === 'glove');

  // Manda una acción al servidor; si falla, toast + la carta tiembla
  const send = useCallback(async (action, cardId) => {
    if (pendingRef.current) return false;
    pendingRef.current = true;
    setPending(true);
    try {
      await useStore.getState().act(action);
      sfx.play();
      cancelAll();
      return true;
    } catch (err) {
      sfx.error();
      toastError(err?.message || 'No se pudo hacer esa jugada');
      const ids = cardId ? [cardId] : action.cardIds || [];
      ids.forEach((id) => {
        const el = document.querySelector(`.gt-hand [data-card-id="${CSS.escape(id)}"] .gc-fly`);
        shake(el, 9);
      });
      return false;
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }, [cancelAll]);

  const play = useCallback((target) => (card ? send({ type: 'play', cardId: card.id, target }, card.id) : false), [send, card]);

  // ---------- Clics ----------

  const onCardClick = useCallback((id) => {
    // Fuera de turno no es un error: la pista avisa con calma (el rebote de la carta lo hace Hand)
    if (!myTurn) {
      sfx.hover();
      showNudge('Podrás jugarla en tu turno', 'hint', 1500);
      return;
    }
    if (discardMode) {
      setDiscardIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : ids.length >= 3 ? ids : [...ids, id]));
      sfx.select();
      return;
    }
    setFirst(null);
    setConfirmGlove(false);
    setSelectedId((cur) => (cur === id ? null : id));
    sfx.select();
  }, [myTurn, discardMode, showNudge]);

  const onSlot = useCallback((playerId, slotId) => {
    if (!card) return false;
    const pick = { playerId, slotId };
    if (!hl.slots.has(slotKey(playerId, slotId))) return false;
    if (mode === 'transplant') {
      if (!first) { setFirst(pick); sfx.select(); return 'step'; }
      const pair = targets.find((t) => (same(t.a, first) && same(t.b, pick)) || (same(t.b, first) && same(t.a, pick)));
      if (!pair) return false;
      return play(pair);
    }
    const t = targets.find((x) => same(x, pick));
    return t ? play(t) : false;
  }, [card, mode, first, hl, targets, play]);

  const onBody = useCallback((playerId) => {
    if (mode !== 'organ') return false;
    const t = targets.find((x) => x.playerId === playerId);
    return t ? play(t) : false;
  }, [mode, targets, play]);

  const onPlayer = useCallback((playerId) => {
    if (mode !== 'medicalError') return false;
    const t = targets.find((x) => x.playerId === playerId);
    return t ? play(t) : false;
  }, [mode, targets, play]);

  const onTable = useCallback(() => {
    if (mode === 'contagion') return play({});
    if (mode === 'glove') { setConfirmGlove(true); return 'confirm'; }
    return false;
  }, [mode, play]);

  const confirmDiscard = useCallback(() => {
    if (!discardIds.length) return false;
    return send({ type: 'discard', cardIds: discardIds }, null);
  }, [discardIds, send]);

  // Tirar una sola carta (botón "Descartarla" cuando no tiene destino, o soltarla en el descarte)
  const discardOne = useCallback((cardId = card?.id) => {
    if (!cardId || !myTurn) return false;
    return send({ type: 'discard', cardIds: [cardId] }, cardId);
  }, [card, myTurn, send]);

  const toggleDiscard = useCallback(() => {
    if (!myTurn) return;
    reset();
    setDiscardMode((m) => !m);
    setDiscardIds([]);
    sfx.click();
  }, [myTurn, reset]);

  // ---------- Arrastrar y soltar ----------

  const dropAt = (point) => {
    if (!point) return null;
    const els = document.elementsFromPoint(point.x - window.scrollX, point.y - window.scrollY);
    for (const el of els) {
      const d = el.closest?.('[data-drop]');
      if (d && !d.closest('.gt-hand')) return d;
    }
    return null;
  };

  // ¿El punto cae sobre el descarte (con 16 px de margen)? Se mide por su rectángulo
  const overDiscard = (point) => {
    const r = point && anchorRect('discard');
    if (!r) return false;
    const x = point.x - window.scrollX;
    const y = point.y - window.scrollY;
    return x >= r.left - 16 && x <= r.right + 16 && y >= r.top - 16 && y <= r.bottom + 16;
  };

  // ¿Se soltó de vuelta sobre la mano? Entonces no hace falta avisar nada. Se mide con las otras cartas
  // de la mano, porque la carta arrastrada siempre está bajo el puntero.
  const overHand = (point, id) => {
    if (!point) return false;
    const x = point.x - window.scrollX;
    const y = point.y - window.scrollY;
    return [...document.querySelectorAll('.gt-hand [data-card-id]')]
      .filter((el) => el.dataset.cardId !== id)
      .some((el) => {
        const r = el.getBoundingClientRect();
        return x >= r.left - 10 && x <= r.right + 10 && y >= r.top - 10 && y <= r.bottom + 10;
      });
  };

  const dropKey = (el) => {
    if (!el) return null;
    const { drop, pid, slot } = el.dataset;
    if (drop === 'slot') return slotKey(pid, slot);
    if (drop === 'body') return `body:${pid}`;
    if (drop === 'player') return `player:${pid}`;
    return drop;
  };

  const onDragStart = useCallback((id) => {
    if (!myTurn || discardMode) return;
    setDragging(true);
    if (selectedId !== id) {
      setFirst(null);
      setSelectedId(id);
      sfx.select();
    }
  }, [myTurn, discardMode, selectedId]);

  const lastHover = useRef(null);
  const onDragMove = useCallback((point) => {
    const el = dropAt(point);
    const k = el ? dropKey(el) : overDiscard(point) ? 'discard' : null;
    if (k !== lastHover.current) {
      lastHover.current = k;
      setHover(k);
      // Al entrar en un destino nuevo, un clic casi inaudible: el destino "atrapa" la carta
      if (k) sfx.hover();
    }
  }, []);

  // Devuelve (o promete) true si la carta se jugó; si no, la carta regresa a la mano
  const onDrop = useCallback((id, point) => {
    lastHover.current = null;
    setHover(null);
    setDragging(false);
    if (id !== card?.id) return false;
    const el = dropAt(point);
    if (!el) {
      if (overDiscard(point)) return discardOne(id);
      if (!overHand(point, id)) showNudge('Suéltala sobre un destino iluminado', 'toast', 1200);
      return false;
    }
    const { drop, pid, slot } = el.dataset;
    let res = false;
    if (drop === 'slot') res = onSlot(pid, slot);
    else if (drop === 'body') res = onBody(pid);
    else if (drop === 'player') res = onPlayer(pid);
    else if (drop === 'table') res = onTable();
    if (res === 'step' || res === 'confirm') return false; // regresa a la mano y espera el siguiente paso
    if (res === false) showNudge('Suéltala sobre un destino iluminado', 'toast', 1200);
    return res;
  }, [card, onSlot, onBody, onPlayer, onTable, discardOne, showNudge]);

  // Esc cancela
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') cancelAll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [cancelAll]);

  const hint = !card
    ? null
    : mode === 'transplant' && first ? HINTS.transplant2 : HINTS[mode];

  return {
    myTurn, playing, layoutTurn: turnIsMine, card, mode, selectedId, first, picked: first ? slotKey(first.playerId, first.slotId) : null,
    targets, hl, hover, tableTarget, hint, pending, dragging, nudge,
    discardMode, discardIds, confirmGlove, setConfirmGlove,
    onCardClick, onSlot, onBody, onPlayer, onTable, confirmDiscard, toggleDiscard, cancelAll, discardOne,
    onDragStart, onDragMove, onDrop, play,
  };
};
