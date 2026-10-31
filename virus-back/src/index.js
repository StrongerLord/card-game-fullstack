// Servidor de Roña: Express (HTTP) + Socket.IO (tiempo real).
// `createServer` arma una instancia aislada (los tests levantan varias en puertos aleatorios);
// si este archivo se ejecuta directamente, arranca en PORT (3001 por defecto).
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { toClientError, fail } from './errors.js';
import { SessionStore, defaultProfile } from './sessions.js';
import { RoomManager } from './rooms.js';
import { parseProfile, parseProfileLoose, parseToken, isPlainObject } from './validate.js';

const envInt = (name, def) => {
  const n = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : def;
};

// Límite de eventos por socket (antiflood general, aparte del límite del chat)
const FLOOD_MAX = 40;
const FLOOD_WINDOW_MS = 2000;

// Topes por IP contra quien abre conexiones/sesiones/salas en bucle (configurables en opts.limits)
const DEFAULT_LIMITS = {
  maxConnectionsPerIp: 20, // sockets abiertos a la vez
  sessionsPerIpPerMin: 20, // sesiones nuevas (hello sin token válido) por minuto
  maxRoomsPerIp: 8, // salas vivas creadas desde la misma IP
};
const SESSION_WINDOW_MS = 60_000;
// Sesiones desconectadas y sin sala: se borran tras este tiempo (antes 6 h)
const SESSION_IDLE_MS = 30 * 60 * 1000;
const PRUNE_EVERY_MS = 5 * 60 * 1000;

// TRUST_PROXY: cuántos proxies propios hay delante (0/apagado, 1, 2…); `true` cuenta como 1
function parseTrustProxy(value) {
  if (value === true) return 1;
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// "::ffff:1.2.3.4" (IPv4 dentro de un socket IPv6) cuenta igual que "1.2.3.4"
const normalizeIp = (ip) => (ip.startsWith('::ffff:') && ip.includes('.') ? ip.slice(7) : ip);

function makeLogger(enabled) {
  const stamp = () => new Date().toISOString().slice(11, 19);
  if (!enabled) return { info() {}, warn() {}, error() {} };
  return {
    info: (...a) => console.log(`[${stamp()}]`, ...a),
    warn: (...a) => console.warn(`[${stamp()}] AVISO:`, ...a),
    error: (...a) => console.error(`[${stamp()}] ERROR:`, ...a),
  };
}

/**
 * Crea el servidor sin escuchar todavía.
 * @param {object} [opts]
 * @param {number} [opts.turnMs]               turno normal (TURN_MS, 40 s)
 * @param {number} [opts.disconnectedTurnMs]   turno de un desconectado (DISCONNECTED_TURN_MS, 8 s)
 * @param {number} [opts.reconnectTurnMs]      margen mínimo al volver en tu turno (15 s)
 * @param {number} [opts.graceMs]              asiento guardado al desconectarse (GRACE_MS, 60 s)
 * @param {number} [opts.botMinMs] [opts.botMaxMs]  lo que "piensa" un bot (1800–3200 ms)
 * @param {boolean} [opts.botReactions]        emotes de los bots tras las jugadas
 * @param {number} [opts.botReactMinMs] [opts.botReactMaxMs]  respiro antes de cada reacción (700–1500 ms)
 * @param {number} [opts.seed]                 semilla fija para las partidas (tests)
 * @param {boolean} [opts.fixedSeats]          no barajar asientos al empezar (tests)
 * @param {string}  [opts.clientOrigin]        CORS; por defecto cualquier origen
 * @param {boolean} [opts.log]                 logs en consola
 * @param {object}  [opts.limits]              topes por IP (ver DEFAULT_LIMITS)
 * @param {boolean|number} [opts.trustProxy]   proxies propios delante (TRUST_PROXY=1): la IP sale de X-Forwarded-For
 */
export function createServer(opts = {}) {
  const timing = {
    turnMs: opts.turnMs ?? envInt('TURN_MS', 40_000),
    disconnectedTurnMs: opts.disconnectedTurnMs ?? envInt('DISCONNECTED_TURN_MS', 8_000),
    reconnectTurnMs: opts.reconnectTurnMs ?? envInt('RECONNECT_TURN_MS', 15_000),
    botMinMs: opts.botMinMs ?? envInt('BOT_MIN_MS', 1800),
    botMaxMs: opts.botMaxMs ?? envInt('BOT_MAX_MS', 3200),
    // Emotes de los bots tras cada jugada (BOT_REACTIONS=0 los apaga)
    botReactions: opts.botReactions ?? process.env.BOT_REACTIONS !== '0',
    botReactMinMs: opts.botReactMinMs ?? envInt('BOT_REACT_MIN_MS', 700),
    botReactMaxMs: opts.botReactMaxMs ?? envInt('BOT_REACT_MAX_MS', 1500),
    seed: opts.seed,
    fixedSeats: !!opts.fixedSeats,
  };
  const graceMs = opts.graceMs ?? envInt('GRACE_MS', 60_000);
  // 0 en una variable desactiva ese tope (útil para pruebas de carga desde una sola IP)
  const limits = {
    maxConnectionsPerIp: envInt('MAX_CONNECTIONS_PER_IP', DEFAULT_LIMITS.maxConnectionsPerIp),
    sessionsPerIpPerMin: envInt('SESSIONS_PER_IP_PER_MIN', DEFAULT_LIMITS.sessionsPerIpPerMin),
    maxRoomsPerIp: envInt('MAX_ROOMS_PER_IP', DEFAULT_LIMITS.maxRoomsPerIp),
    ...(opts.limits || {}),
  };
  const trustProxy = parseTrustProxy(opts.trustProxy ?? process.env.TRUST_PROXY);
  const log = makeLogger(opts.log ?? process.env.LOG !== '0');

  const originSetting = opts.clientOrigin ?? process.env.CLIENT_ORIGIN;
  const origin = originSetting ? originSetting.split(',').map((s) => s.trim()).filter(Boolean) : true;

  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin }));

  const httpServer = http.createServer(app);
  const io = new Server(httpServer, {
    cors: { origin, methods: ['GET', 'POST'] },
    // Un mensaje de más de 16 KB hace que Socket.IO corte la conexión sin ack (es lo esperado:
    // ningún evento legítimo se acerca; el chat tiene tope de 200 caracteres)
    maxHttpBufferSize: 16 * 1024,
  });

  let rooms = null;
  let closing = false;
  const sessions = new SessionStore({
    graceMs,
    log,
    onGraceExpired: (session) => rooms.onGraceExpired(session),
  });
  rooms = new RoomManager({ io, sessions, timing, log, limits });

  // ---------- topes por IP ----------

  // Detrás de `trustProxy` proxies propios, la IP real es la que anotó el más lejano de ellos en
  // X-Forwarded-For: la N-ésima desde la derecha. Lo de más a la izquierda lo pudo escribir el
  // cliente, así que no se usa (antes se tomaba la primera y cualquiera podía falsear su IP).
  const ipOf = (socket) => {
    const address = normalizeIp(socket.handshake.address || '');
    if (!trustProxy) return address;
    const fwd = socket.handshake.headers['x-forwarded-for'];
    const hops = typeof fwd === 'string' ? fwd.split(',').map((s) => s.trim()).filter(Boolean) : [];
    if (!hops.length) return address;
    return normalizeIp(hops[Math.max(0, hops.length - trustProxy)]);
  };
  const connectionsByIp = new Map(); // ip -> sockets abiertos
  const sessionsByIp = new Map(); // ip -> marcas de tiempo de sesiones creadas

  io.use((socket, next) => {
    const ip = ipOf(socket);
    const n = connectionsByIp.get(ip) || 0;
    if (limits.maxConnectionsPerIp && n >= limits.maxConnectionsPerIp) {
      log.warn(`Conexión rechazada: ${ip} ya tiene ${n} abiertas`);
      return next(new Error('TOO_MANY_CONNECTIONS'));
    }
    connectionsByIp.set(ip, n + 1);
    socket.data.ip = ip;
    socket.once('disconnect', () => {
      const left = (connectionsByIp.get(ip) || 1) - 1;
      if (left > 0) connectionsByIp.set(ip, left);
      else connectionsByIp.delete(ip);
    });
    next();
  });

  // Registra una sesión nueva para la IP; lanza RATE_LIMITED si ya creó demasiadas en el último minuto
  const takeSessionSlot = (ip) => {
    const now = Date.now();
    const times = (sessionsByIp.get(ip) || []).filter((t) => now - t < SESSION_WINDOW_MS);
    if (limits.sessionsPerIpPerMin && times.length >= limits.sessionsPerIpPerMin) {
      sessionsByIp.set(ip, times);
      fail('RATE_LIMITED', 'Demasiadas sesiones nuevas desde tu red, espera un minuto');
    }
    times.push(now);
    sessionsByIp.set(ip, times);
  };

  app.get('/health', (req, res) => res.json({ ok: true }));
  app.get('/rooms', (req, res) => res.json(rooms.list()));
  app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'No existe' } }));
  // Express 4 necesita los 4 parámetros para reconocer el manejador de errores
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    log.error('Error HTTP:', err);
    res.status(500).json({ ok: false, error: { code: 'INTERNAL', message: 'Error interno del servidor' } });
  });

  // ---------- sockets ----------

  io.on('connection', (socket) => {
    const flood = [];

    // Registra un manejador con ack: valida, atrapa cualquier excepción y responde siempre
    const handle = (event, fn, { needsSession = true } = {}) => {
      socket.on(event, (...args) => {
        const ack = typeof args[args.length - 1] === 'function' ? args.pop() : null;
        const reply = (res) => {
          if (!ack) return;
          try { ack(res); } catch (err) { log.error(`Fallo al responder ${event}:`, err); }
        };
        const now = Date.now();
        while (flood.length && now - flood[0] > FLOOD_WINDOW_MS) flood.shift();
        if (flood.length >= FLOOD_MAX) {
          reply({ ok: false, error: { code: 'RATE_LIMITED', message: 'Demasiadas peticiones, más despacio' } });
          return;
        }
        flood.push(now);
        try {
          const session = sessions.getBySocket(socket.id);
          if (needsSession && !session) {
            reply({ ok: false, error: { code: 'NO_SESSION', message: 'Primero manda session:hello' } });
            return;
          }
          const data = fn(args[0], session) || {};
          reply({ ok: true, ...data });
        } catch (err) {
          const error = toClientError(err);
          if (error.code === 'INTERNAL') log.error(`Error en ${event}:`, err);
          reply({ ok: false, error });
        }
      });
    };

    handle('session:hello', (payload) => {
      const p = isPlainObject(payload) ? payload : {};
      const token = parseToken(p.token);
      const current = sessions.getBySocket(socket.id);
      // Un socket tiene una sola sesión: sin token válido se reutiliza la que ya tiene
      // (antes se creaba otra y la anterior quedaba de anfitriona fantasma de su sala)
      let session = sessions.getByToken(token) || current;
      const restored = !!session;
      if (!session) {
        takeSessionSlot(socket.data.ip);
        session = sessions.create(parseProfileLoose(p.profile, defaultProfile()), { ip: socket.data.ip });
      } else if (p.profile !== undefined) {
        session.profile = parseProfileLoose(p.profile, session.profile);
      }
      session.ip = socket.data.ip;

      // Si este socket ya era de otra sesión, se suelta de ella y de los canales de su sala
      const switching = current && current !== session ? current : null;
      if (switching) {
        for (const r of socket.rooms) if (r.startsWith('room:')) socket.leave(r);
      }
      const previous = sessions.attach(session, socket.id);
      if (switching) rooms.onDisconnected(switching);
      if (previous) {
        // Otra pestaña tenía esta sesión: se le avisa y se corta (no se reconecta sola)
        const old = io.sockets.sockets.get(previous);
        if (old) {
          old.emit('session:replaced');
          old.disconnect(true);
        }
      }
      if (restored) {
        log.info(`${session.profile.name} recuperó su sesión`);
        if (session.roomId) rooms.onProfileChanged(session);
        rooms.onSessionRestored(session);
      }
      return { token: session.token, playerId: session.playerId, profile: session.profile, roomId: session.roomId };
    }, { needsSession: false });

    handle('profile:update', (payload, session) => {
      session.profile = parseProfile(payload);
      rooms.onProfileChanged(session);
      return { profile: session.profile };
    });

    handle('rooms:list', () => ({ rooms: rooms.list() }), { needsSession: false });
    handle('room:create', (payload, session) => rooms.create(session, payload));
    handle('room:join', (payload, session) => rooms.join(session, payload));
    handle('room:leave', (payload, session) => rooms.leave(session, 'leave'));
    handle('room:addBot', (payload, session) => rooms.addBot(session, payload));
    handle('room:kick', (payload, session) => rooms.kick(session, payload));
    handle('room:start', (payload, session) => rooms.start(session, payload));
    handle('room:chat', (payload, session) => rooms.chat(session, payload));
    handle('room:emote', (payload, session) => rooms.emote(session, payload));
    handle('room:rematch', (payload, session) => rooms.rematch(session, payload));
    handle('game:action', (payload, session) => rooms.act(session, payload));

    socket.on('disconnect', () => {
      try {
        if (closing) return;
        const session = sessions.getBySocket(socket.id);
        if (!session || session.socketId !== socket.id) return;
        sessions.detach(session);
        rooms.onDisconnected(session);
      } catch (err) {
        log.error('Error al desconectar:', err);
      }
    });
  });

  // Limpieza periódica de sesiones viejas sin sala
  const pruneTimer = setInterval(() => {
    const n = sessions.prune(SESSION_IDLE_MS);
    if (n) log.info(`Se borraron ${n} sesiones inactivas`);
    const now = Date.now();
    for (const [ip, times] of sessionsByIp) {
      if (!times.some((t) => now - t < SESSION_WINDOW_MS)) sessionsByIp.delete(ip);
    }
  }, PRUNE_EVERY_MS);
  pruneTimer.unref();

  return {
    app,
    io,
    httpServer,
    rooms,
    sessions,
    timing,
    // Escucha en `port` (0 = aleatorio) y resuelve con el puerto real
    listen(port = 0, host) {
      return new Promise((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, host, () => {
          httpServer.off('error', reject);
          resolve(httpServer.address().port);
        });
      });
    },
    close() {
      closing = true;
      clearInterval(pruneTimer);
      rooms.dispose();
      sessions.dispose();
      return new Promise((resolve) => {
        io.close(() => resolve());
      });
    },
  };
}

// ---------- arranque directo ----------

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  process.on('uncaughtException', (err) => console.error('ERROR no atrapado:', err));
  process.on('unhandledRejection', (err) => console.error('Promesa rechazada sin atrapar:', err));

  const server = createServer();
  const port = envInt('PORT', 3001);
  server.listen(port).then(
    (p) => console.log(`Servidor de Roña escuchando en http://localhost:${p}`),
    (err) => {
      console.error(`No se pudo abrir el puerto ${port}:`, err.message);
      process.exit(1);
    },
  );
  const shutdown = () => {
    console.log('Apagando el servidor…');
    server.close().finally(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
