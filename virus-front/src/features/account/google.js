// Google Identity Services: carga el script una sola vez y lo inicializa con el client ID que
// anuncia el servidor. El ID token (credential) se manda tal cual al servidor, que es quien lo verifica.
const GSI_SRC = 'https://accounts.google.com/gsi/client';

let loading = null;
let initializedFor = null;
let onCredential = null; // el último manejador registrado (el botón visible)

export function loadGis() {
  if (window.google?.accounts?.id) return Promise.resolve(window.google);
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      script.onload = () => (window.google?.accounts?.id ? resolve(window.google) : reject(new Error('GIS sin cargar')));
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('No se pudo cargar Google'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}

// Inicializa GIS (una vez por client ID) y deja `handler` como receptor del credential
export function initGis(google, clientId, handler) {
  onCredential = handler;
  if (initializedFor === clientId) return;
  initializedFor = clientId;
  google.accounts.id.initialize({
    client_id: clientId,
    callback: (res) => res?.credential && onCredential?.(res.credential),
    auto_select: false,
    cancel_on_tap_outside: true,
    ux_mode: 'popup',
    context: 'signin',
  });
}

// Al cerrar sesión, que Google no vuelva a elegir la cuenta solo
export function forgetGoogleChoice() {
  try { window.google?.accounts?.id?.disableAutoSelect(); } catch { /* sin GIS */ }
}
