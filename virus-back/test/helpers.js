// Utilidades de los tests de integración: levantar un servidor en un puerto aleatorio
// y clientes Socket.IO con helpers basados en Promise.
import { io as connect } from 'socket.io-client';
import { createServer } from '../src/index.js';

export async function startServer(opts = {}) {
  const server = createServer({ log: false, dbFile: ':memory:', ...opts });
  const port = await server.listen(0, '127.0.0.1');
  const url = `http://127.0.0.1:${port}`;
  const clients = [];
  return {
    server,
    url,
    // Cliente nuevo; si pasas `hello`, hace session:hello y guarda el resultado en c.session
    async client({ hello = true, token, profile } = {}) {
      const c = makeClient(url);
      clients.push(c);
      await c.connected;
      if (hello) c.session = await c.ok('session:hello', { token, profile });
      return c;
    },
    async close() {
      for (const c of clients) c.socket.disconnect();
      await server.close();
    },
  };
}

export function makeClient(url) {
  const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false });
  const log = []; // todo lo que llega del servidor: { ev, data }
  const waiters = [];
  socket.onAny((ev, data) => {
    log.push({ ev, data });
    for (const w of [...waiters]) {
      if (w.ev === ev && w.pred(data)) {
        waiters.splice(waiters.indexOf(w), 1);
        clearTimeout(w.timer);
        w.resolve(data);
      }
    }
  });
  const c = {
    socket,
    log,
    session: null,
    connected: new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    }),
    // Emite con ack y resuelve con la respuesta tal cual
    req(ev, payload) {
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error(`Sin ack para ${ev}`)), 3000);
        const cb = (res) => { clearTimeout(t); resolve(res); };
        if (payload === undefined) socket.emit(ev, cb);
        else socket.emit(ev, payload, cb);
      });
    },
    // Igual que req pero falla si la respuesta no es ok
    async ok(ev, payload) {
      const res = await c.req(ev, payload);
      if (!res || !res.ok) throw new Error(`${ev} falló: ${JSON.stringify(res)}`);
      return res;
    },
    // Espera la respuesta con error y devuelve el código
    async errCode(ev, payload) {
      const res = await c.req(ev, payload);
      if (res.ok) throw new Error(`${ev} debía fallar y respondió ok`);
      return res.error.code;
    },
    // Espera el próximo evento `ev` que cumpla `pred` (o el último ya recibido si `past`)
    waitFor(ev, pred = () => true, { timeout = 3000, past = false } = {}) {
      if (past) {
        for (let i = log.length - 1; i >= 0; i--) if (log[i].ev === ev && pred(log[i].data)) return Promise.resolve(log[i].data);
      }
      return new Promise((resolve, reject) => {
        const w = { ev, pred, resolve };
        w.timer = setTimeout(() => {
          waiters.splice(waiters.indexOf(w), 1);
          reject(new Error(`Timeout esperando ${ev}`));
        }, timeout);
        waiters.push(w);
      });
    },
    last(ev) {
      for (let i = log.length - 1; i >= 0; i--) if (log[i].ev === ev) return log[i].data;
      return undefined;
    },
    all(ev) {
      return log.filter((x) => x.ev === ev).map((x) => x.data);
    },
  };
  return c;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
