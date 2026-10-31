import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { cardLabel } from '../../lib/cards';
import { sfx, isMuted, toggleMute, onMuteChange } from '../../lib/sfx';
import { computeLayout, opponentsOf } from './layout';
import { useEventPlayer, registerDeal } from './events';
import { useInteraction } from './interaction';
import { Seat } from './Seat';
import { Body } from './Body';
import { Hand } from './Hand';
import { Avatar } from './Avatar';
import { CenterPiles } from './CenterPiles';
import { FxLayer } from './FxLayer';
import { Narrator, ErrorToasts, TurnBanner, toastError } from './Overlays';
import { ConfirmDialog, EndModal } from './Dialogs';
import { ChatPanel } from './ChatPanel';
import { CardTip } from './CardTip';
import { EmotePicker } from '../emotes/EmotePicker';
import doodles from '../../assets/doodles.png';
import './game.css';

// Modo de demostración sólo en desarrollo: ?demo=game | ?demo=game6
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const demo = new URLSearchParams(window.location.search).get('demo');
  if (demo && demo.startsWith('game')) import('./demo.js').then((m) => m.startDemo(demo));
}

// ---------- Hooks auxiliares ----------

const useWindowSize = () => {
  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    let raf;
    const onResize = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setSize({ w: window.innerWidth, h: window.innerHeight }));
    };
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  }, []);
  return size;
};

// Reloj local del turno: se calcula una vez por turno a partir de turnDeadline (aguanta el desfase de relojes)
const useTurnTimer = (view) => {
  const ref = useRef({ key: null, value: null });
  if (!view || view.winner) return null;
  const key = `${view.turnNumber}:${view.turnPlayerId}:${view.turnDeadline}`;
  if (ref.current.key !== key) {
    const now = Date.now();
    const total = view.turnMs || 40000;
    const remaining = view.turnDeadline ? Math.max(0, Math.min(total, view.turnDeadline - now)) : total;
    ref.current = { key, value: { start: now - (total - remaining), end: now + remaining } };
  }
  return ref.current.value;
};

const useMuted = () => {
  const [muted, setMutedState] = useState(isMuted());
  useEffect(() => onMuteChange(setMutedState), []);
  return muted;
};

// Segundos restantes, re-renderizando sólo este pedacito
const Countdown = memo(function Countdown({ end }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.ceil((end - now) / 1000));
  return <span className={`gt-count ${s <= 5 ? 'is-low' : ''}`}>{s}s</span>;
});

// ---------- Íconos ----------

const SpeakerIcon = ({ muted }) => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor" />
    {muted
      ? <path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      : <path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />}
  </svg>
);
const ExitIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    <path d="m15 8 4 4-4 4M19 12H9" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const btnAnim = {
  layout: true,
  initial: { opacity: 0, scale: 0.6, y: 10 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.6, transition: { duration: 0.12 } },
  transition: { type: 'spring', stiffness: 500, damping: 28 },
};

// ---------- Pantalla ----------

export const GameScreen = () => {
  const session = useStore((s) => s.session);
  const room = useStore((s) => s.room);
  const storeGame = useStore((s) => s.game);
  const me = storeGame?.you ?? session?.playerId;

  // Reparto en cascada: se registra antes de que se monten las cartas
  useState(() => registerDeal(storeGame, me));

  const view = useEventPlayer({ me });
  const size = useWindowSize();
  const players = useMemo(() => view?.players || [], [view]);
  const opps = useMemo(() => opponentsOf(players, me), [players, me]);
  const L = useMemo(() => computeLayout(size.w, size.h, opps.length), [size.w, size.h, opps.length]);
  const ix = useInteraction({ view, me });
  const timer = useTurnTimer(view);
  const muted = useMuted();
  const [chatOpen, setChatOpen] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [showEnd, setShowEnd] = useState(false);

  const infoOf = useMemo(() => {
    const map = new Map((room?.players || []).map((p) => [p.id, p]));
    return (id) => map.get(id);
  }, [room]);

  const myGp = players.find((p) => p.id === me);
  const turnGp = players.find((p) => p.id === view?.turnPlayerId);
  const winner = view?.winner || null;

  // Tic-tac de los últimos 5 segundos de mi turno
  useEffect(() => {
    if (!ix.myTurn || !timer) return undefined;
    const ids = [];
    for (let s = 5; s >= 1; s--) {
      const at = timer.end - s * 1000 - Date.now();
      if (at > 0) ids.push(setTimeout(() => sfx.tick(), at));
    }
    return () => ids.forEach(clearTimeout);
  }, [ix.myTurn, timer]);

  // Teclado: al elegir una carta (o el primer órgano del trasplante) el foco salta al primer destino;
  // al soltarla o jugarla, regresa a la mano. Sólo si se está usando el teclado, para no robar el foco al ratón.
  const usingKeyboard = useRef(false);
  useEffect(() => {
    const kb = (e) => { if (['Tab', 'Enter', ' ', 'Escape'].includes(e.key)) usingKeyboard.current = true; };
    const ptr = () => { usingKeyboard.current = false; };
    window.addEventListener('keydown', kb, true);
    window.addEventListener('pointerdown', ptr, true);
    return () => {
      window.removeEventListener('keydown', kb, true);
      window.removeEventListener('pointerdown', ptr, true);
    };
  }, []);
  const hadCard = useRef(false);
  useEffect(() => {
    const had = hadCard.current;
    hadCard.current = !!ix.card;
    if (!usingKeyboard.current) return undefined;
    const t = setTimeout(() => {
      const active = document.activeElement;
      if (ix.card) {
        if (active?.matches?.('.gt-root [data-drop][tabindex="0"]')) return;
        document.querySelector('.gt-root [data-drop][tabindex="0"]')?.focus({ preventScroll: true });
      } else if (had && !active?.closest?.('.gt-hand, .gt-modal, .gt-chat')) {
        document.querySelector('.gt-hand .gt-hand-card')?.focus({ preventScroll: true });
      }
    }, 60);
    return () => clearTimeout(t);
  }, [ix.card, ix.first, ix.hl]);

  // El modal de fin aparece cuando ya se vio la jugada ganadora
  useEffect(() => {
    if (!winner) { setShowEnd(false); return undefined; }
    const t = setTimeout(() => setShowEnd(true), 1100);
    return () => clearTimeout(t);
  }, [winner]);

  // Esc también cierra el chat y los diálogos
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      setConfirmExit(false);
      setChatOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const leave = useCallback(async () => {
    setLeaving(true);
    try {
      await useStore.getState().leaveRoom();
    } catch (err) {
      toastError(err?.message || 'No se pudo salir de la sala');
      setLeaving(false);
    }
  }, []);

  const rematch = useCallback(async () => {
    try {
      await useStore.getState().rematch();
    } catch (err) {
      toastError(err?.message || 'No se pudo pedir la revancha');
    }
  }, []);

  if (!view || !me) return <div className="gt-root gt-loading">Cargando la mesa…</div>;

  const { me: M } = L;
  const handCard = M.hand.card;
  const actionsLeft = M.hand.cx + M.hand.width / 2 + L.gap * 2;
  const canPass = ix.myTurn && view.hand.length === 0;

  // Texto de ayuda sobre mi cuerpo
  let hint = null;
  if (winner) hint = null;
  else if (ix.discardMode) hint = { title: 'Descartar', text: `Elige de 1 a 3 cartas para tirar (${ix.discardIds.length}/3)` };
  else if (ix.card) {
    const noTargets = !ix.tableTarget && ix.targets.length === 0;
    hint = {
      title: cardLabel(ix.card),
      text: ix.hint,
      warn: noTargets ? 'Ahora no tiene ningún destino: mejor descártala' : null,
    };
  } else if (ix.myTurn) hint = { title: '¡Tu turno!', text: 'Juega una carta (clic o arrástrala) o descarta' };
  else if (turnGp) hint = { title: `Turno de ${turnGp.name}`, text: 'Mientras, puedes ver tus cartas', color: infoOf(turnGp.id)?.color };

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div
          className={`gt-root ${ix.card ? 'has-selection' : ''} ${ix.myTurn ? 'is-my-turn' : ''} ${L.portrait ? 'is-portrait' : ''}`}
          style={{ '--radius': `${L.radius}px`, '--pad': `${L.pad}px`, '--gap': `${L.gap}px`, '--u': `${Math.min(size.w / 1920, size.h / 1080)}` }}
        >
          <div className="gt-bg" style={{ backgroundImage: `url(${doodles})` }} />

          <CenterPiles
            center={L.center}
            deckCount={view.deckCount}
            discardTop={view.discardTop}
            discardCount={view.discardCount}
            tableTarget={ix.tableTarget}
            hover={ix.hover}
            onTable={ix.onTable}
          />

          {opps.map((gp, i) => (
            <Seat
              key={gp.id}
              seat={L.seats[i]}
              gp={gp}
              info={infoOf(gp.id)}
              hl={ix.hl}
              picked={ix.picked}
              hover={ix.hover}
              onSlot={ix.onSlot}
              onPlayer={ix.onPlayer}
              timer={timer}
              gap={L.gap}
            />
          ))}

          {/* Mi cuerpo */}
          <div
            className={`gt-me-panel ${myGp?.isTurn ? 'is-turn' : ''}`}
            style={{ left: M.panel.x, top: M.panel.y, width: M.panel.w, height: M.panel.h, paddingTop: L.pad + M.hintRoom, '--pc': infoOf(me)?.color || '#ffae00' }}
          >
            {myGp && (
              <Body
                playerId={me}
                body={myGp.body}
                card4={M.card4}
                card5={M.card5}
                cols={5}
                gap={L.gap * 1.6}
                hl={ix.hl}
                picked={ix.picked}
                hover={ix.hover}
                onSlot={ix.onSlot}
                organTarget={ix.hl.bodies.has(me)}
                onBody={ix.onBody}
                className="gt-my-body"
                ownerName={myGp.name}
                mine
              />
            )}
          </div>

          {/* Pista de la carta seleccionada / de quién es el turno */}
          <div className="gt-hint-wrap" style={{ left: size.w / 2, top: M.panel.y }}>
            <AnimatePresence mode="wait">
              {hint && (
                <motion.div
                  key={hint.title + (hint.warn || '')}
                  className={`gt-hint ${ix.card ? 'is-card' : ''}`}
                  style={{ '--hc': hint.color || 'var(--accent)' }}
                  initial={{ opacity: 0, y: 12, scale: 0.9 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.95, transition: { duration: 0.15 } }}
                  transition={{ type: 'spring', stiffness: 500, damping: 32 }}
                >
                  <strong>{hint.title}</strong>
                  <span>{hint.text}</span>
                  {hint.warn && <em>{hint.warn}</em>}
                  {ix.myTurn && timer && <Countdown end={timer.end} />}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Mi avatar */}
          {myGp && (
            <div className="gt-me-avatar" style={M.avatar.left !== undefined ? { left: M.avatar.left, top: M.avatar.y } : { right: M.avatar.right, top: M.avatar.y }}>
              <Avatar info={infoOf(me)} gp={myGp} size={M.avatar.size} timer={myGp.isTurn ? timer : null} isMe nameSide={M.avatar.nameSide || 'left'} nameMax={M.avatar.nameMax} />
            </div>
          )}

          <Hand
            hand={view.hand}
            layout={M.hand}
            myTurn={ix.myTurn}
            selectedId={ix.selectedId}
            discardMode={ix.discardMode}
            discardIds={ix.discardIds}
            onCardClick={ix.onCardClick}
            onDragStart={ix.onDragStart}
            onDragMove={ix.onDragMove}
            onDrop={ix.onDrop}
          />

          {/* Botones de acción junto a la mano */}
          <div className={`gt-actions ${M.actions?.row ? 'is-row' : ''}`} style={M.actions ? { right: M.actions.right, bottom: M.actions.bottom, height: M.avatar.size } : { left: actionsLeft, bottom: L.pad * 1.5 }}>
            <AnimatePresence mode="popLayout">
              {ix.myTurn && !ix.discardMode && !ix.card && view.hand.length > 0 && (
                <motion.button key="discard" type="button" className="gt-btn gt-btn-ghost" onClick={ix.toggleDiscard} {...btnAnim}>
                  Descartar
                </motion.button>
              )}
              {ix.discardMode && (
                <motion.button key="confirm-discard" type="button" className="gt-btn gt-btn-accent" disabled={!ix.discardIds.length || ix.pending} onClick={ix.confirmDiscard} {...btnAnim}>
                  Tirar {ix.discardIds.length || ''}
                </motion.button>
              )}
              {ix.mode === 'contagion' && (
                <motion.button key="contagion" type="button" className="gt-btn gt-btn-accent gt-btn-pulse" disabled={ix.pending} onClick={() => ix.play({})} {...btnAnim}>
                  Contagiar
                </motion.button>
              )}
              {ix.mode === 'glove' && (
                <motion.button key="glove" type="button" className="gt-btn gt-btn-accent gt-btn-pulse" disabled={ix.pending} onClick={() => ix.setConfirmGlove(true)} {...btnAnim}>
                  Usar guante
                </motion.button>
              )}
              {canPass && (
                <motion.button
                  key="pass"
                  type="button"
                  className="gt-btn gt-btn-accent"
                  onClick={() => useStore.getState().act({ type: 'pass' }).catch((e) => toastError(e?.message || 'No se pudo pasar'))}
                  {...btnAnim}
                >
                  Pasar
                </motion.button>
              )}
              {(ix.card || ix.discardMode) && (
                <motion.button key="cancel" type="button" className="gt-btn gt-btn-ghost gt-btn-small" onClick={ix.cancelAll} title="Esc" {...btnAnim}>
                  Cancelar
                </motion.button>
              )}
            </AnimatePresence>
          </div>

          <Narrator style={L.narrator || { left: L.center.x + L.pad, top: L.center.y, width: Math.max(200, (L.center.w - L.center.card.w * 2.5) / 2 - L.pad * 2) }} />
          <ErrorToasts style={{ left: size.w / 2, bottom: handCard.h * 0.95 + L.pad }} />

          {/* Controles: sonido, chat, salir */}
          <div className="gt-controls" style={L.controls}>
            <button
              type="button"
              className={`gt-icon-btn ${muted ? 'is-off' : ''}`}
              onClick={() => { toggleMute(); sfx.click(); }}
              aria-label={muted ? 'Activar sonido' : 'Silenciar'}
              title={muted ? 'Activar sonido' : 'Silenciar'}
            >
              <SpeakerIcon muted={muted} />
            </button>
            <EmotePicker buttonClassName="gt-icon-btn" />
            <ChatPanel me={me} open={chatOpen} onToggle={() => setChatOpen((o) => !o)} />
            <button type="button" className="gt-icon-btn" onClick={() => setConfirmExit(true)} aria-label="Salir de la partida" title="Salir">
              <ExitIcon />
            </button>
          </div>

          <FxLayer />
          <CardTip view={view} me={me} />
          <TurnBanner />

          <ConfirmDialog
            open={ix.confirmGlove}
            title="¿Usar el guante de látex?"
            text="Todos los demás tiran su mano completa y pierden su siguiente turno."
            confirmLabel="¡Úsalo!"
            onConfirm={() => { ix.setConfirmGlove(false); ix.play({}); }}
            onCancel={() => ix.setConfirmGlove(false)}
          />
          <ConfirmDialog
            open={confirmExit}
            title="¿Salir de la partida?"
            text={winner ? 'Vas a volver al lobby.' : 'Si sales, tus cartas van al descarte y ya no podrás volver a esta partida.'}
            confirmLabel="Salir"
            danger
            onConfirm={() => { setConfirmExit(false); leave(); }}
            onCancel={() => setConfirmExit(false)}
          />
          <EndModal
            winner={showEnd ? winner : null}
            winnerInfo={winner ? { ...infoOf(winner.playerId), name: players.find((p) => p.id === winner.playerId)?.name } : null}
            isMe={winner?.playerId === me}
            isHost={room?.hostId === me}
            onRematch={rematch}
            onLeave={leave}
            busy={leaving}
            scores={room?.players || []}
            me={me}
          />
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
};
