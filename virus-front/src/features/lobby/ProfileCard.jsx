import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { AVATARS, avatarImage } from '../../lib/avatars';
import { toast, toastError } from './toasts';
import { IconCheck, IconChevronLeft, IconChevronRight } from './icons';
import { AccountSection, GoogleMark } from '../account/AccountSection';

export const SWATCHES = [
  '#ffae00', '#ff7a1a', '#ff4d4d', '#ff7ab6', '#c070ff',
  '#6a5cff', '#1e90ff', '#00c2c7', '#20c040', '#8bd400',
];

export const NAME_MAX = 16;
export const validateName = (name) => {
  const n = name.trim();
  if (!n) return 'Escribe tu nombre';
  if (n.length > NAME_MAX) return `Máximo ${NAME_MAX} caracteres`;
  return null;
};

const wrap = (i) => (i + AVATARS.length) % AVATARS.length;

// Carrusel del avatar: clic en la cara o en las flechas para cambiar
const AvatarPicker = ({ value, color, onChange, signedIn = false }) => {
  const [dir, setDir] = useState(1);
  const go = (delta) => {
    setDir(delta);
    onChange(wrap(value + delta));
  };
  return (
    <div className="avatar-picker">
      <motion.button type="button" className="avatar-picker__arrow" onClick={() => go(-1)} whileTap={{ scale: 0.8, x: -4 }} aria-label="Avatar anterior">
        <IconChevronLeft />
      </motion.button>

      <div className="avatar-picker__holder">
        <motion.button
          type="button"
          className="avatar-picker__frame"
          style={{ '--avatar-color': color }}
          onClick={() => go(1)}
          whileHover={{ scale: 1.05, rotate: -2 }}
          whileTap={{ scale: 0.92 }}
          aria-label="Cambiar avatar"
          title="Toca para cambiar"
        >
          <AnimatePresence initial={false} custom={dir} mode="popLayout">
            <motion.img
              key={value}
              src={avatarImage(value)}
              alt={`Avatar ${value + 1}`}
              draggable="false"
              custom={dir}
              variants={{
                enter: (d) => ({ x: d * 110, opacity: 0, rotate: d * 20, scale: 0.6 }),
                center: { x: 0, opacity: 1, rotate: 0, scale: 1 },
                exit: (d) => ({ x: d * -110, opacity: 0, rotate: d * -20, scale: 0.6 }),
              }}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            />
          </AnimatePresence>
        </motion.button>
        {/* Estado de la sesión: con cuenta de Google, la "G" en la esquina */}
        <AnimatePresence>
          {signedIn && (
            <motion.span
              className="avatar-picker__badge"
              title="Perfil guardado en tu cuenta de Google"
              initial={{ scale: 0, rotate: -90 }}
              animate={{ scale: 1, rotate: 0 }}
              exit={{ scale: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 16 }}
            >
              <GoogleMark />
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <motion.button type="button" className="avatar-picker__arrow" onClick={() => go(1)} whileTap={{ scale: 0.8, x: 4 }} aria-label="Avatar siguiente">
        <IconChevronRight />
      </motion.button>

      <div className="avatar-picker__dots" role="tablist" aria-label="Avatares">
        {AVATARS.map((_, i) => (
          <button
            type="button"
            key={i}
            role="tab"
            aria-selected={i === value}
            aria-label={`Avatar ${i + 1}`}
            className={`avatar-picker__dot ${i === value ? 'is-active' : ''}`}
            onClick={() => { setDir(i > value ? 1 : -1); onChange(i); }}
          >
            {i === value && <motion.span layoutId="avatar-dot" className="avatar-picker__dot-fill" />}
          </button>
        ))}
      </div>
    </div>
  );
};

export const ColorPicker = ({ value, onChange }) => (
  <div className="swatches" role="radiogroup" aria-label="Color">
    {SWATCHES.map((c) => {
      const active = c.toLowerCase() === (value || '').toLowerCase();
      return (
        <motion.button
          type="button"
          key={c}
          role="radio"
          aria-checked={active}
          aria-label={`Color ${c}`}
          className={`swatch ${active ? 'is-active' : ''}`}
          style={{ '--swatch': c }}
          onClick={() => onChange(c)}
          whileHover={{ scale: 1.18, y: -2 }}
          whileTap={{ scale: 0.85 }}
          animate={{ scale: active ? 1.12 : 1 }}
        >
          <AnimatePresence>
            {active && (
              <motion.span initial={{ scale: 0, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} exit={{ scale: 0 }} className="swatch__check">
                <IconCheck />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      );
    })}
  </div>
);

// Tarjeta de perfil: avatar, color y nombre; se guarda en el servidor
export const ProfileCard = () => {
  const profile = useStore((s) => s.profile);
  const updateProfile = useStore((s) => s.updateProfile);
  const signedIn = useStore((s) => !!s.account);
  const [draft, setDraft] = useState(profile);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Si el perfil cambia desde fuera (sesión recuperada, modal de nombre), actualiza el borrador
  useEffect(() => { setDraft(profile); }, [profile]);

  const error = validateName(draft.name || '');
  const dirty = (draft.name || '').trim() !== (profile.name || '')
    || draft.avatar !== profile.avatar
    || (draft.color || '').toLowerCase() !== (profile.color || '').toLowerCase();
  const saved = !dirty && !!profile.name;

  const save = async (e) => {
    e?.preventDefault();
    setTouched(true);
    if (error || !dirty || saving) return;
    setSaving(true);
    try {
      await updateProfile({ ...draft, name: (draft.name || '').trim() });
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 1600);
      toast('Perfil guardado', 'success');
    } catch (err) {
      toastError(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <motion.form
      className="ui-panel profile-card"
      onSubmit={save}
      initial={{ opacity: 0, x: -60, rotate: -3 }}
      animate={{ opacity: 1, x: 0, rotate: 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 20, delay: 0.05 }}
    >
      <div className="panel-tab">Tu perfil</div>

      <AvatarPicker
        value={draft.avatar}
        color={draft.color}
        signedIn={signedIn}
        onChange={(avatar) => setDraft((d) => ({ ...d, avatar }))}
      />

      <div className="field">
        <label className="field__label" htmlFor="profile-name">
          Nombre
          <span className={`field__count ${(draft.name || '').length > NAME_MAX ? 'is-over' : ''}`}>{(draft.name || '').trim().length}/{NAME_MAX}</span>
        </label>
        <input
          id="profile-name"
          className="ui-input profile-card__name"
          value={draft.name || ''}
          maxLength={NAME_MAX + 4}
          placeholder="¿Cómo te llamas?"
          autoComplete="nickname"
          aria-invalid={touched && !!error}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          onBlur={() => setTouched(true)}
          style={{ color: draft.color }}
        />
        <AnimatePresence>
          {touched && error && (
            <motion.p className="field__error" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              {error}
            </motion.p>
          )}
        </AnimatePresence>
      </div>

      <div className="field">
        <span className="field__label">Color</span>
        <ColorPicker value={draft.color} onChange={(color) => setDraft((d) => ({ ...d, color }))} />
      </div>

      <motion.button
        type="submit"
        className={`ui-btn ${saved ? 'ui-btn--success' : 'ui-btn--purple'} profile-card__save`}
        disabled={saving || (!dirty && !saved) || (dirty && !!error)}
        whileTap={{ scale: 0.95 }}
        animate={justSaved ? { scale: [1, 1.12, 1] } : { scale: 1 }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={saving ? 'saving' : saved ? 'saved' : 'save'}
            className="profile-card__save-label"
            initial={{ y: 14, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -14, opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {saving ? (<><span className="ui-spinner" /> Guardando</>)
              : saved ? (<><IconCheck /> Guardado</>)
                : 'Guardar perfil'}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <AccountSection />
    </motion.form>
  );
};
