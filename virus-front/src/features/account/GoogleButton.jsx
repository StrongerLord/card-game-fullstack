import { useEffect, useRef, useState } from 'react';
import { useStore } from '../../store/useStore';
import { toast, toastError } from '../lobby/toasts';
import { initGis, loadGis } from './google';
import './account.css';

// Botón oficial "Entrar con Google" (lo pinta GIS dentro del contenedor). Sólo existe si el
// servidor anunció un GOOGLE_CLIENT_ID; si no, no se muestra nada.
export const GoogleButton = ({ onDone }) => {
  const clientId = useStore((s) => s.authConfig.googleClientId);
  const box = useRef(null);
  const [state, setState] = useState('loading'); // 'loading' | 'ready' | 'error' | 'busy'
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (!clientId) return undefined;
    let alive = true;
    loadGis().then((google) => {
      if (!alive || !box.current) return;
      initGis(google, clientId, async (credential) => {
        setState('busy');
        try {
          const res = await useStore.getState().loginGoogle(credential);
          toast(res.created ? `¡Bienvenid@, ${res.profile.name}! Tu perfil quedó guardado` : `Hola de nuevo, ${res.profile.name}`, 'success');
          done.current?.();
        } catch (err) {
          toastError(err);
        } finally {
          setState('ready');
        }
      });
      const width = Math.round(Math.min(400, Math.max(200, box.current.offsetWidth || 260)));
      google.accounts.id.renderButton(box.current, {
        type: 'standard',
        theme: 'filled_blue',
        size: 'large',
        shape: 'pill',
        text: 'continue_with',
        logo_alignment: 'left',
        locale: 'es',
        width,
      });
      setState('ready');
    }).catch(() => alive && setState('error'));
    return () => { alive = false; };
  }, [clientId]);

  if (!clientId) return null;
  return (
    <div className={`google-btn is-${state}`}>
      <div ref={box} className="google-btn__slot" />
      {state === 'loading' && <span className="google-btn__note"><span className="ui-spinner" /> Cargando Google…</span>}
      {state === 'busy' && <span className="google-btn__note"><span className="ui-spinner" /> Entrando…</span>}
      {state === 'error' && <span className="google-btn__note is-error">No se pudo cargar Google. Revisa tu conexión.</span>}
    </div>
  );
};
