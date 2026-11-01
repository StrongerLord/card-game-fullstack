// Verificación del ID token de Google Identity Services (el "credential" que entrega el botón).
// Con AUTH_DEV_FAKE=1 (y nunca en producción) se aceptan además credenciales "dev:<sub>:<nombre>"
// para probar sin Google.
import { fail } from './errors.js';
import { cleanText } from './validate.js';

export const CREDENTIAL_MAX = 4096;
const DEV_RE = /^dev:([A-Za-z0-9_-]{1,64}):(.{1,40})$/s;

/**
 * @param {{ clientId?: string, devFake?: boolean }} o
 * @returns {(credential: string) => Promise<{ sub: string, email: string, name: string }>}
 */
export function createVerifier({ clientId, devFake }) {
  let client = null; // OAuth2Client, se carga sólo si hay GOOGLE_CLIENT_ID

  return async (credential) => {
    if (typeof credential !== 'string' || !credential || credential.length > CREDENTIAL_MAX) {
      fail('BAD_PAYLOAD', '"credential" no es válido');
    }
    if (devFake && credential.startsWith('dev:')) {
      const m = DEV_RE.exec(credential);
      if (!m) fail('BAD_PAYLOAD', 'Credencial de prueba: usa dev:<sub>:<nombre>');
      return { sub: `dev-${m[1]}`, email: `${m[1]}@dev.local`, name: cleanText(m[2]) };
    }
    if (!clientId) fail('AUTH_DISABLED', 'El inicio de sesión con Google no está activado en este servidor');
    if (!client) {
      const { OAuth2Client } = await import('google-auth-library');
      client = new OAuth2Client(clientId);
    }
    let payload;
    try {
      const ticket = await client.verifyIdToken({ idToken: credential, audience: clientId });
      payload = ticket.getPayload();
    } catch {
      fail('AUTH_FAILED', 'Google no validó tu inicio de sesión, inténtalo otra vez');
    }
    if (!payload?.sub) fail('AUTH_FAILED', 'Google no validó tu inicio de sesión, inténtalo otra vez');
    return {
      sub: payload.sub,
      email: payload.email_verified === false ? '' : payload.email || '',
      name: cleanText(payload.given_name || payload.name || ''),
    };
  };
}
