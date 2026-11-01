import { useState } from 'react';
import { motion } from 'framer-motion';
import { useStore } from '../../store/useStore';
import { CrownIcon } from '../game/CrownIcon';
import { IconPlay } from '../lobby/icons';
import { toast, toastError } from '../lobby/toasts';
import { GoogleButton } from './GoogleButton';
import { forgetGoogleChoice } from './google';
import './account.css';

// "G" de Google (marca simplificada, para la insignia de sesión)
export const GoogleMark = (p) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.8z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.8 3.6-4.9 6.7-4.9z" />
  </svg>
);

// Debajo de la tarjeta de perfil: estadísticas y "cerrar sesión" con cuenta; botón de Google sin ella
export const AccountSection = () => {
  const account = useStore((s) => s.account);
  const clientId = useStore((s) => s.authConfig.googleClientId);
  const [busy, setBusy] = useState(false);

  if (!account) {
    if (!clientId) return null;
    return (
      <div className="account-box account-box--guest">
        <p className="account-box__pitch">Entra con Google para guardar tu perfil y tus partidas, y para agregar amigos</p>
        <GoogleButton />
      </div>
    );
  }

  const { played, won } = account.stats || { played: 0, won: 0 };
  const logout = async () => {
    setBusy(true);
    try {
      await useStore.getState().logout();
      forgetGoogleChoice();
      toast('Cerraste sesión: sigues jugando como invitad@', 'info');
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="account-box">
      <div className="account-stats" aria-label="Tus partidas">
        <div className="account-stat">
          <span className="account-stat__icon"><IconPlay /></span>
          <motion.b key={`p${played}`} initial={{ scale: 1.6 }} animate={{ scale: 1 }}>{played}</motion.b>
          <span>{played === 1 ? 'jugada' : 'jugadas'}</span>
        </div>
        <div className="account-stat account-stat--won">
          <span className="account-stat__icon"><CrownIcon /></span>
          <motion.b key={`w${won}`} initial={{ scale: 1.6 }} animate={{ scale: 1 }}>{won}</motion.b>
          <span>{won === 1 ? 'ganada' : 'ganadas'}</span>
        </div>
      </div>
      <div className="account-box__row">
        <span className="account-box__who" title={account.email || 'Cuenta de Google'}>
          <GoogleMark className="account-box__g" />
          <span className="account-box__email">{account.email || 'Cuenta de Google'}</span>
        </span>
        <button type="button" className="account-box__logout" onClick={logout} disabled={busy}>
          {busy ? <span className="ui-spinner" /> : 'Cerrar sesión'}
        </button>
      </div>
    </div>
  );
};
