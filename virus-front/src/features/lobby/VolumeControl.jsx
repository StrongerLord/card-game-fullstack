import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { IconMusic, IconSparkle, IconVolume, IconVolumeLow, IconVolumeOff } from './icons';
import { sfx, getVolume, setVolume, onVolumeChange, isMuted, setMuted, toggleMute, onMuteChange } from '../../lib/sfx';

// Control de volumen: un botón con la bocina que abre un panelito con la música y los efectos por
// separado, más "Silenciar todo". Clic derecho o mantener presionado el botón silencia directo.
// Va en un portal a <body> para que no lo recorten los overflow de la mesa; en vertical es una hoja inferior.
const POP_W = 220;
const LONG_PRESS_MS = 500;

const useAudioPrefs = () => {
  const [state, setState] = useState(() => ({ music: getVolume('music'), sfx: getVolume('sfx'), muted: isMuted() }));
  useEffect(() => {
    const offVol = onVolumeChange((kind, v) => setState((s) => ({ ...s, [kind]: v })));
    const offMute = onMuteChange((muted) => setState((s) => ({ ...s, muted })));
    return () => { offVol(); offMute(); };
  }, []);
  return state;
};

const isSheet = (btn) => window.innerWidth <= 600 || !!btn?.closest?.('.is-portrait');

// Dónde va el panel: pegado al botón, por debajo si hay lugar y si no por encima, sin salirse de la pantalla
const placeFor = (btn) => {
  if (!btn) return null;
  if (isSheet(btn)) return { sheet: true };
  const r = btn.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = Math.max(8, Math.min(vw - POP_W - 8, r.right - POP_W));
  const below = r.bottom + 220 < vh;
  return below
    ? { sheet: false, left, top: r.bottom + 10, origin: `${r.left + r.width / 2 - left}px top` }
    : { sheet: false, left, bottom: vh - r.top + 10, origin: `${r.left + r.width / 2 - left}px bottom` };
};

const VolumeRow = ({ kind, label, Icon, value, muted, onCommit }) => (
  <label className={`vol-row ${muted || value === 0 ? 'is-zero' : ''}`}>
    <span className="vol-row__icon"><Icon /></span>
    <span className="vol-row__label">{label}</span>
    <input
      type="range"
      className="vol-range"
      min={0}
      max={100}
      step={5}
      value={value}
      aria-label={`Volumen de ${label.toLowerCase()}`}
      aria-valuetext={`${value} %`}
      style={{ '--v': `${value}%` }}
      onChange={(e) => setVolume(kind, e.target.value)}
      onPointerUp={onCommit}
      onKeyUp={(e) => { if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End' || e.key === 'PageUp' || e.key === 'PageDown') onCommit?.(); }}
    />
    <span className="vol-row__pct">{value}%</span>
  </label>
);

export const VolumeControl = ({ buttonClassName = 'ui-icon-btn', variant = 'lobby' }) => {
  const prefs = useAudioPrefs();
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState(null);
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const pressTimer = useRef(null);
  const swallowClick = useRef(false);

  const loudest = Math.max(prefs.music, prefs.sfx);
  const off = prefs.muted || loudest === 0;
  const Icon = off ? IconVolumeOff : loudest < 50 ? IconVolumeLow : IconVolume;

  const close = useCallback((focusBack = true) => {
    setOpen(false);
    if (focusBack) btnRef.current?.focus({ preventScroll: true });
  }, []);

  // Se recoloca al abrir y si cambia el tamaño de la ventana
  useLayoutEffect(() => {
    if (!open) return undefined;
    const update = () => setPlace(placeFor(btnRef.current));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [open]);

  // Esc y clic fuera lo cierran
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
    };
    const onDown = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      close(false);
    };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('pointerdown', onDown, true);
    // El foco entra al primer control para poder seguir con el teclado
    const t = setTimeout(() => popRef.current?.querySelector('input')?.focus({ preventScroll: true }), 60);
    return () => {
      clearTimeout(t);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('pointerdown', onDown, true);
    };
  }, [open, close]);

  useEffect(() => () => clearTimeout(pressTimer.current), []);

  const quickMute = () => {
    toggleMute();
    sfx.click();
    setOpen(false);
  };

  const onPointerDown = (e) => {
    if (e.button !== 0) return;
    clearTimeout(pressTimer.current);
    pressTimer.current = setTimeout(() => {
      swallowClick.current = true;
      quickMute();
      navigator.vibrate?.(15);
    }, LONG_PRESS_MS);
  };
  const cancelPress = () => clearTimeout(pressTimer.current);

  const onClick = () => {
    if (swallowClick.current) { swallowClick.current = false; return; }
    setOpen((o) => !o);
    sfx.click();
  };

  const label = prefs.muted ? 'Sonido silenciado: ajustar volumen' : 'Ajustar volumen';
  const sheet = place?.sheet;

  const panel = (
    <AnimatePresence>
      {open && place && (
        <>
          {sheet && (
            <motion.div
              key="vol-back"
              className="vol-back"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              aria-hidden
            />
          )}
          <motion.div
            key="vol-pop"
            ref={popRef}
            className={`vol-pop vol-pop--${variant} ${sheet ? 'is-sheet' : ''}`}
            role="dialog"
            aria-label="Volumen"
            style={sheet ? undefined : { left: place.left, top: place.top, bottom: place.bottom, width: POP_W, transformOrigin: place.origin }}
            initial={sheet ? { y: '100%' } : { opacity: 0, scale: 0.9 }}
            animate={sheet ? { y: 0 } : { opacity: 1, scale: 1 }}
            exit={sheet ? { y: '100%', transition: { duration: 0.18 } } : { opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
            transition={sheet ? { type: 'spring', stiffness: 420, damping: 32 } : { type: 'spring', stiffness: 500, damping: 30 }}
            onKeyDown={(e) => { if (e.key !== 'Escape') e.stopPropagation(); }}
          >
            {sheet && <div className="vol-pop__grab" aria-hidden />}
            <div className="vol-pop__title">Volumen</div>
            <VolumeRow kind="music" label="Música" Icon={IconMusic} value={prefs.music} muted={prefs.muted} />
            <VolumeRow kind="sfx" label="Efectos" Icon={IconSparkle} value={prefs.sfx} muted={prefs.muted} onCommit={() => sfx.select()} />
            <button
              type="button"
              role="switch"
              aria-checked={prefs.muted}
              className={`vol-mute ${prefs.muted ? 'is-on' : ''}`}
              onClick={() => { setMuted(!prefs.muted); sfx.click(); }}
            >
              <span className="vol-mute__icon"><IconVolumeOff /></span>
              <span>Silenciar todo</span>
              <span className="vol-switch" aria-hidden><i /></span>
            </button>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  return (
    <>
      <motion.button
        ref={btnRef}
        type="button"
        className={`${buttonClassName} vol-btn ${off ? 'is-off' : ''} ${open ? 'is-open' : ''}`}
        onClick={onClick}
        onPointerDown={onPointerDown}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        onContextMenu={(e) => { e.preventDefault(); cancelPress(); quickMute(); }}
        whileHover={variant === 'lobby' ? { rotate: [0, -10, 10, 0] } : undefined}
        title={`${label} (clic derecho: silenciar)`}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <motion.span key={off ? 'off' : Icon === IconVolumeLow ? 'low' : 'on'} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} style={{ display: 'grid', width: '100%', height: '100%', placeItems: 'center' }}>
          <Icon />
        </motion.span>
      </motion.button>
      {typeof document !== 'undefined' && createPortal(panel, document.body)}
    </>
  );
};
