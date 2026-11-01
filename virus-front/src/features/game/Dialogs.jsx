import { memo, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import avatars from '../../lib/avatars';
import { sfx } from '../../lib/sfx';
import { reducedMotion } from './fx';
import { useFitFont } from './fitText';
import { EmoteBubble } from '../emotes/EmoteBubble';
import { EmoteRow } from '../emotes/EmotePicker';
import { CrownIcon } from './CrownIcon';
import { IconEye } from '../lobby/icons';

// Diálogo de confirmación propio (sin window.confirm)
export const ConfirmDialog = memo(function ConfirmDialog({ open, title, text, confirmLabel = 'Sí', cancelLabel = 'Cancelar', danger, onConfirm, onCancel }) {
  const btn = useRef(null);
  useEffect(() => { if (open) setTimeout(() => btn.current?.focus(), 50); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="gt-modal-back" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onCancel}>
          <motion.div
            className="gt-modal gt-confirm"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ scale: 0.7, y: 40, rotate: -3 }}
            animate={{ scale: 1, y: 0, rotate: 0 }}
            exit={{ scale: 0.8, y: 30, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 380, damping: 24 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="gt-modal-title">{title}</div>
            {text && <p>{text}</p>}
            <div className="gt-modal-actions">
              <button type="button" className="gt-btn gt-btn-ghost" onClick={onCancel}>{cancelLabel}</button>
              <button type="button" ref={btn} className={`gt-btn ${danger ? 'gt-btn-danger' : 'gt-btn-accent'}`} onClick={onConfirm}>{confirmLabel}</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

// Lluvia de confeti en varias ráfagas
const celebrate = () => {
  if (reducedMotion()) return () => {};
  const colors = ['#885FFE', '#ffae00', '#ffffff', '#20c040', '#ff4d4d', '#1e90ff'];
  const end = Date.now() + 2600;
  let raf;
  confetti({ particleCount: 140, spread: 90, startVelocity: 55, origin: { y: 0.65 }, colors, zIndex: 400 });
  const frame = () => {
    confetti({ particleCount: 4, angle: 60, spread: 60, origin: { x: 0, y: 0.7 }, colors, zIndex: 400 });
    confetti({ particleCount: 4, angle: 120, spread: 60, origin: { x: 1, y: 0.7 }, colors, zIndex: 400 });
    if (Date.now() < end) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const t = setTimeout(() => confetti({ particleCount: 120, spread: 140, startVelocity: 40, origin: { y: 0.4 }, colors, shapes: ['star'], zIndex: 400 }), 900);
  return () => { cancelAnimationFrame(raf); clearTimeout(t); };
};

// Fin de la partida: victoria (confeti) o derrota (lluvia de roña)
// Marcador de la sala: victorias acumuladas entre revanchas
const Scoreboard = ({ scores, me, winnerId }) => {
  const rows = [...scores].sort((a, b) => b.wins - a.wins);
  const top = rows[0]?.wins || 0;
  return (
    <ol className="gt-score" aria-label="Marcador de la sala">
      {rows.map((p) => (
        <motion.li
          key={p.id}
          layout
          className={`gt-score-row ${p.id === winnerId ? 'is-winner' : ''} ${p.id === me ? 'is-me' : ''}`}
          style={{ '--pc': p.color, '--as': '40px' }}
        >
          <img src={avatars[p.avatar ?? 0] || avatars[0]} alt="" />
          <span className="gt-score-name">{p.name}{p.id === me && <small> (tú)</small>}</span>
          <span className="gt-score-wins">
            {p.wins > 0 && p.wins === top && <CrownIcon className="gt-score-crown" title="Va ganando" />}
            {p.id === winnerId
              ? <motion.b key={p.wins} initial={{ scale: 2.4, color: '#ffae00' }} animate={{ scale: 1, color: '#2a1a5e' }} transition={{ delay: 0.6, type: 'spring', stiffness: 300, damping: 12 }}>{p.wins}</motion.b>
              : <b>{p.wins}</b>}
          </span>
          <EmoteBubble playerId={p.id} side="right" />
        </motion.li>
      ))}
    </ol>
  );
};

export const EndModal = memo(function EndModal({ winner, winnerInfo, isMe, isHost, onRematch, onLeave, busy, scores = [], me }) {
  useEffect(() => {
    if (!winner) return undefined;
    if (isMe) {
      sfx.win();
      return celebrate();
    }
    sfx.lose();
    return undefined;
  }, [winner?.playerId]); // eslint-disable-line react-hooks/exhaustive-deps

  const name = winnerInfo?.name || 'Alguien';
  const forfeit = winner?.reason === 'forfeit';
  const title = isMe ? '¡Ganaste!' : `Ganó ${name}`;

  // El título se achica hasta caber en 2 renglones sin partir el nombre (medido con la fuente real)
  const titleRef = useRef(null);
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 800 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // "Ver mesa": el modal se reduce a una píldora abajo para ver cómo quedó la mesa
  const [peek, setPeek] = useState(false);
  useEffect(() => { if (!winner) setPeek(false); }, [winner]);
  useFitFont(titleRef, Math.round(Math.max(28, Math.min(80, vh * 0.08))), 18, [title, !!winner, peek]);

  return (
    <>
    <AnimatePresence>
      {winner && peek && (
        <motion.button
          key="end-pill"
          type="button"
          className={`gt-end-pill ${isMe ? 'is-win' : 'is-lose'}`}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20, transition: { duration: 0.2 } }}
          transition={{ duration: 0.2 }}
          onClick={() => { setPeek(false); sfx.click(); }}
        >
          <CrownIcon className="gt-end-pill-crown" />
          Ver resultados
        </motion.button>
      )}
    </AnimatePresence>
    <AnimatePresence>
      {winner && !peek && (
        <motion.div className={`gt-modal-back gt-end ${isMe ? 'is-win' : 'is-lose'}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.2 } }}>
          {!isMe && (
            <div className="gt-rain" aria-hidden>
              {Array.from({ length: 22 }, (_, i) => (
                <span key={i} style={{ left: `${(i * 4.7 + (i % 3) * 7) % 100}%`, animationDelay: `${(i % 7) * 0.28}s`, animationDuration: `${2.2 + (i % 5) * 0.35}s` }} />
              ))}
            </div>
          )}
          {isMe && <div className="gt-end-rays" aria-hidden />}
          <motion.div
            className="gt-modal gt-end-card"
            role="dialog"
            aria-modal="true"
            initial={isMe ? { scale: 0.3, rotate: -10, y: 80 } : { y: -400, rotate: 0 }}
            animate={isMe ? { scale: 1, rotate: 0, y: 0 } : { y: 0, rotate: [0, 0, -4, 3, -1, 0] }}
            transition={isMe ? { type: 'spring', stiffness: 220, damping: 14 } : { duration: 1.1, ease: 'easeOut', times: [0, 0.5, 0.65, 0.8, 0.9, 1] }}
          >
            <div className="gt-end-avatar" style={{ '--pc': winnerInfo?.color || '#ffae00' }}>
              <svg className="gt-end-crown" viewBox="0 0 24 24" aria-hidden>
                <path d="M22.766,4.566A1.994,1.994,0,0,0,20.586,5L18,7.586,13.414,3a2,2,0,0,0-2.828,0L6,7.586,3.414,5A2,2,0,0,0,0,6.414V17a5.006,5.006,0,0,0,5,5H19a5.006,5.006,0,0,0,5-5V6.414A2,2,0,0,0,22.766,4.566Z" fill="#ffc61a" stroke="#8a5a00" strokeWidth="1" />
                <circle cx="12" cy="15" r="2.2" fill="#ff4d4d" /><circle cx="6" cy="16" r="1.4" fill="#1e90ff" /><circle cx="18" cy="16" r="1.4" fill="#20c040" />
              </svg>
              <img src={avatars[winnerInfo?.avatar ?? 0] || avatars[0]} alt="" />
            </div>
            <div className="gt-end-title" ref={titleRef}>{title}</div>
            <p className="gt-end-sub">
              {forfeit
                ? (isMe ? 'Los demás abandonaron la partida.' : `${name} se quedó solo en la mesa.`)
                : (isMe ? 'Tienes 4 órganos sanos. ¡Eres inmune a la roña!' : 'La roña te ganó esta vez. ¡Ánimo para la revancha!')}
            </p>
            {scores.length > 1 && <Scoreboard scores={scores} me={me} winnerId={winner.playerId} />}
            <EmoteRow className="gt-end-emotes" />
            <div className="gt-modal-actions gt-end-actions">
              <button type="button" className="gt-btn gt-btn-ghost gt-end-leave" onClick={onLeave} disabled={busy}>Salir</button>
              <button type="button" className="gt-btn gt-btn-ghost gt-end-peek" onClick={() => { setPeek(true); sfx.click(); }} aria-label="Ver mesa" title="Ver cómo quedó la mesa">
                <IconEye /> <span>Ver mesa</span>
              </button>
              {isHost
                ? <button type="button" className="gt-btn gt-btn-accent gt-end-rematch" onClick={onRematch} disabled={busy}>Revancha</button>
                : <span className="gt-end-wait">Esperando a que el anfitrión pida la revancha…</span>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </>
  );
});
