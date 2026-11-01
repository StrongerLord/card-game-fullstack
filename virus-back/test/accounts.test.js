// Tests de integración: cuentas (credenciales de prueba AUTH_DEV_FAKE), persistencia entre
// reinicios, estadísticas y amigos (solicitudes, aceptar, estado en vivo e invitaciones).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer, sleep } from './helpers.js';

const profile = (name, avatar = 1, color = '#ff0000') => ({ name, avatar, color });
const dev = (sub, name) => `dev:${sub}:${name}`;

// Cliente con cuenta: hello + auth:google con la credencial de prueba
async function loggedIn(srv, sub, name, extra = {}) {
  const c = await srv.client({ profile: extra.profile });
  c.auth = await c.ok('auth:google', { credential: dev(sub, name) });
  return c;
}

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rona-db-')), 'rona.db');

describe('Cuentas', () => {
  test('sin AUTH_DEV_FAKE ni GOOGLE_CLIENT_ID no se puede entrar; el hello lo anuncia', async () => {
    const srv = await startServer();
    try {
      const a = await srv.client({ profile: profile('Ana') });
      assert.deepEqual(a.session.auth, { googleClientId: null, devFake: false });
      assert.equal(a.session.account, null);
      assert.equal(await a.errCode('auth:google', { credential: dev('ana', 'Ana') }), 'AUTH_DISABLED');
      assert.equal(await a.errCode('friends:list'), 'NOT_LOGGED_IN');
      const cfg = await fetch(`${srv.url}/config`).then((r) => r.json());
      assert.deepEqual(cfg, { googleClientId: null });
    } finally {
      await srv.close();
    }
  });

  test('NODE_ENV=production ignora AUTH_DEV_FAKE', async () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await srv.client();
      assert.equal(a.session.auth.devFake, false);
      assert.equal(await a.errCode('auth:google', { credential: dev('x', 'X') }), 'AUTH_DISABLED');
    } finally {
      process.env.NODE_ENV = prev;
      await srv.close();
    }
  });

  test('credencial de prueba: crea la cuenta con tu perfil, valida y no filtra el email', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await srv.client({ profile: profile('Vane', 3, '#00ff00') });
      const res = await a.ok('auth:google', { credential: dev('vane', 'Vanessa') });
      assert.equal(res.created, true);
      assert.ok(res.authToken);
      // Traía un nombre propio: se queda con él (no con el de Google)
      assert.deepEqual(res.profile, { name: 'Vane', avatar: 3, color: '#00ff00' });
      assert.match(res.account.friendCode, /^[A-HJKMNP-Z2-9]{6}$/);
      assert.deepEqual(res.account.stats, { played: 0, won: 0 });
      assert.equal(res.account.email, 'vane@dev.local');

      // Sin nombre propio (perfil al azar): toma el de Google
      const b = await srv.client();
      const rb = await b.ok('auth:google', { credential: dev('beto', 'Roberto Gómez Bolaños') });
      assert.equal(rb.profile.name, 'Roberto Gómez Bo');

      // Payloads malos
      assert.equal(await b.errCode('auth:google', null), 'BAD_PAYLOAD');
      assert.equal(await b.errCode('auth:google', { credential: 42 }), 'BAD_PAYLOAD');
      assert.equal(await b.errCode('auth:google', { credential: 'x'.repeat(5000) }), 'BAD_PAYLOAD');
      assert.equal(await b.errCode('auth:google', { credential: 'dev:mal sub:Nombre' }), 'BAD_PAYLOAD');
      // Sin GOOGLE_CLIENT_ID, un token "de verdad" no se acepta
      assert.equal(await b.errCode('auth:google', { credential: 'eyJhbGciOi.xxx.yyy' }), 'AUTH_DISABLED');

      // El email nunca sale hacia otros: ni en la sala ni en la lista de amigos
      await a.ok('room:create', { name: 'Mesa' });
      const state = a.last('room:state');
      assert.ok(!JSON.stringify(state).includes('@dev.local'));
    } finally {
      await srv.close();
    }
  });

  test('el login respeta el tope de intentos', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await srv.client();
      for (let i = 0; i < 6; i++) await a.req('auth:google', { credential: 'dev:mal' });
      assert.equal(await a.errCode('auth:google', { credential: dev('ok', 'Ok') }), 'RATE_LIMITED');
    } finally {
      await srv.close();
    }
  });

  test('el perfil vive en la cuenta: otro dispositivo lo recupera; logout vuelve a invitado', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await loggedIn(srv, 'ana', 'Ana', { profile: profile('Anita', 2, '#123456') });
      await a.ok('profile:update', { name: 'Ana Pro', avatar: 5, color: '#abcdef' });

      // "Otro dispositivo": sesión nueva con otro perfil local; al entrar, manda el de la cuenta
      const b = await srv.client({ profile: profile('Otra', 0, '#000000') });
      const rb = await b.ok('auth:google', { credential: dev('ana', 'Ana') });
      assert.equal(rb.created, false);
      assert.deepEqual(rb.profile, { name: 'Ana Pro', avatar: 5, color: '#abcdef' });
      assert.equal(rb.account.id, a.auth.account.id);
      assert.equal(rb.account.friendCode, a.auth.account.friendCode);

      // Un cambio en un dispositivo le llega al otro
      const pushed = a.waitFor('profile:update');
      await b.ok('profile:update', { name: 'Ana Max', avatar: 6, color: '#abcdef' });
      assert.equal((await pushed).name, 'Ana Max');

      // Logout: invitado otra vez (conserva el perfil) y el token ya no sirve
      const out = await b.ok('auth:logout');
      assert.equal(out.profile.name, 'Ana Max');
      assert.equal(await b.errCode('friends:list'), 'NOT_LOGGED_IN');
      const c = await srv.client({ profile: profile('Tercera') });
      const rc = await c.ok('session:hello', { token: c.session.token, auth: rb.authToken });
      assert.equal(rc.account, null);
      // El otro dispositivo sigue con su sesión
      const ra = await a.ok('session:hello', { token: a.session.token, auth: a.auth.authToken });
      assert.equal(ra.account.id, a.auth.account.id);
    } finally {
      await srv.close();
    }
  });

  test('persistencia: la cuenta, el perfil, los amigos y el token sobreviven a un reinicio', async () => {
    const dbFile = tmpDb();
    let srv = await startServer({ authDevFake: true, dbFile });
    let a = await loggedIn(srv, 'ana', 'Ana', { profile: profile('Ana', 4, '#ff00ff') });
    const b = await loggedIn(srv, 'beto', 'Beto', { profile: profile('Beto') });
    await a.ok('friends:request', { code: b.auth.account.friendCode });
    const incoming = (await b.ok('friends:list')).incoming;
    await b.ok('friends:respond', { requestId: incoming[0].id, accept: true });
    const { authToken } = a.auth;
    const accountId = a.auth.account.id;
    await srv.close();

    srv = await startServer({ authDevFake: true, dbFile });
    try {
      // Sesión nueva (el servidor olvidó las sesiones), pero el token de cuenta la liga otra vez
      a = await srv.client({ profile: profile('Invitado') });
      const r = await a.ok('session:hello', { token: a.session.token, auth: authToken });
      assert.equal(r.account.id, accountId);
      assert.deepEqual(r.profile, { name: 'Ana', avatar: 4, color: '#ff00ff' });
      const list = await a.ok('friends:list');
      assert.deepEqual(list.friends.map((f) => [f.name, f.status]), [['Beto', 'offline']]);
    } finally {
      await srv.close();
      fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
    }
  });

  test('estadísticas: jugadas y ganadas se guardan al terminar la partida', async () => {
    const srv = await startServer({ authDevFake: true, fixedSeats: true, seed: 7 });
    try {
      const a = await loggedIn(srv, 'ana', 'Ana', { profile: profile('Ana') });
      const b = await loggedIn(srv, 'beto', 'Beto', { profile: profile('Beto') });
      const guest = await srv.client({ profile: profile('Invi') });
      const { roomId } = await a.ok('room:create', { name: 'Stats' });
      await b.ok('room:join', { roomId });
      await guest.ok('room:join', { roomId });
      await a.ok('room:start');
      await a.waitFor('game:state', () => true, { past: true });
      // Beto y el invitado abandonan: Ana gana por abandono
      const aUpdate = a.waitFor('account:update');
      const bUpdate = b.waitFor('account:update');
      await b.ok('room:leave');
      await guest.ok('room:leave');
      assert.deepEqual((await aUpdate).stats, { played: 1, won: 1 });
      assert.deepEqual((await bUpdate).stats, { played: 1, won: 0 });
      // Lo ven sus amigos y lo devuelve el hello
      const r = await b.ok('session:hello', { token: b.session.token, auth: b.auth.authToken });
      assert.deepEqual(r.account.stats, { played: 1, won: 0 });
    } finally {
      await srv.close();
    }
  });
});

describe('Amigos', () => {
  test('solicitud por código, aceptar, rechazar, quitar y validaciones', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await loggedIn(srv, 'ana', 'Ana', { profile: profile('Ana') });
      const b = await loggedIn(srv, 'beto', 'Beto', { profile: profile('Beto') });
      const c = await loggedIn(srv, 'caro', 'Caro', { profile: profile('Caro') });
      const guest = await srv.client({ profile: profile('Invi') });

      assert.equal(await guest.errCode('friends:request', { code: b.auth.account.friendCode }), 'NOT_LOGGED_IN');
      assert.equal(await a.errCode('friends:request', { code: 'O0I1L!' }), 'BAD_PAYLOAD');
      assert.equal(await a.errCode('friends:request', {}), 'BAD_PAYLOAD');
      assert.equal(await a.errCode('friends:request', { code: 'ZZZZZZ' === b.auth.account.friendCode ? 'YYYYYY' : 'ZZZZZZ' }), 'FRIEND_NOT_FOUND');
      assert.equal(await a.errCode('friends:request', { code: a.auth.account.friendCode }), 'FRIEND_SELF');

      // Ana → Beto (en minúsculas y con guion también vale); a Beto le llega friends:update
      const bUpd = b.waitFor('friends:update', (d) => d.incoming.length === 1);
      const code = b.auth.account.friendCode;
      const sent = await a.ok('friends:request', { code: `${code.slice(0, 3)}-${code.slice(3).toLowerCase()}` });
      assert.equal(sent.status, 'sent');
      assert.deepEqual(sent.friend, { id: b.auth.account.id, name: 'Beto', avatar: 1, color: '#ff0000' });
      const upd = await bUpd;
      assert.equal(upd.incoming[0].from.name, 'Ana');
      assert.equal(upd.incoming[0].from.email, undefined);
      assert.equal((await a.ok('friends:list')).outgoing[0].to.name, 'Beto');

      // Beto acepta: ambos se ven en línea
      const aUpd = a.waitFor('friends:update', (d) => d.friends.length === 1);
      assert.equal(await c.errCode('friends:respond', { requestId: upd.incoming[0].id, accept: true }), 'REQUEST_NOT_FOUND');
      assert.equal(await b.errCode('friends:respond', { requestId: upd.incoming[0].id, accept: 'si' }), 'BAD_PAYLOAD');
      await b.ok('friends:respond', { requestId: upd.incoming[0].id, accept: true });
      const la = await aUpd;
      assert.equal(la.friends[0].name, 'Beto');
      assert.equal(la.friends[0].status, 'online');
      assert.equal(la.friends[0].email, undefined);
      assert.deepEqual(la.outgoing, []);
      assert.equal(await a.errCode('friends:request', { code }), 'ALREADY_FRIENDS');

      // Caro → Ana y Ana rechaza
      await c.ok('friends:request', { code: a.auth.account.friendCode });
      const req = (await a.ok('friends:list')).incoming[0];
      await a.ok('friends:respond', { requestId: req.id, accept: false });
      assert.deepEqual((await c.ok('friends:list')).outgoing, []);

      // Solicitudes cruzadas: si el otro ya te la había mandado, quedan como amigos
      await c.ok('friends:request', { code: b.auth.account.friendCode });
      const cross = await b.ok('friends:request', { code: c.auth.account.friendCode });
      assert.equal(cross.status, 'accepted');
      assert.deepEqual((await c.ok('friends:list')).friends.map((f) => f.name), ['Beto']);

      // Quitar
      assert.equal(await a.errCode('friends:remove', { friendId: c.auth.account.id }), 'FRIEND_NOT_FOUND');
      assert.equal(await a.errCode('friends:remove', { friendId: '../x' }), 'BAD_PAYLOAD');
      await a.ok('friends:remove', { friendId: b.auth.account.id });
      assert.deepEqual((await b.ok('friends:list')).friends.map((f) => f.name), ['Caro']);
    } finally {
      await srv.close();
    }
  });

  test('tope de solicitudes por minuto', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await loggedIn(srv, 'ana', 'Ana');
      for (let i = 0; i < 10; i++) await a.req('friends:request', { code: 'ZZZZZ2' });
      assert.equal(await a.errCode('friends:request', { code: 'ZZZZZ2' }), 'RATE_LIMITED');
    } finally {
      await srv.close();
    }
  });

  test('estado en vivo e invitaciones a tu sala', async () => {
    const srv = await startServer({ authDevFake: true });
    try {
      const a = await loggedIn(srv, 'ana', 'Ana', { profile: profile('Ana') });
      const b = await loggedIn(srv, 'beto', 'Beto', { profile: profile('Beto') });
      await a.ok('friends:request', { code: b.auth.account.friendCode });
      await b.ok('friends:request', { code: a.auth.account.friendCode }); // cruzada = aceptada
      const betoOf = (d) => d.friends.find((f) => f.name === 'Beto');
      const anaOf = (d) => d.friends.find((f) => f.name === 'Ana');

      // Sin sala no se puede invitar
      assert.equal(await a.errCode('friends:invite', { friendId: b.auth.account.id }), 'NOT_IN_ROOM');

      // Ana crea sala: Beto la ve en línea en esa sala y que se puede unir
      let bUpd = b.waitFor('friends:update', (d) => anaOf(d)?.room);
      const { roomId } = await a.ok('room:create', { name: 'Mesa de Ana' });
      let ana = anaOf(await bUpd);
      assert.equal(ana.status, 'online');
      assert.deepEqual(ana.room, { id: roomId, name: 'Mesa de Ana', joinable: true });

      // Invitar: a Beto le llega friends:invited con la sala; se respeta el respiro por amigo
      const invited = b.waitFor('friends:invited');
      await a.ok('friends:invite', { friendId: b.auth.account.id });
      const inv = await invited;
      assert.equal(inv.roomId, roomId);
      assert.equal(inv.roomName, 'Mesa de Ana');
      assert.equal(inv.from.name, 'Ana');
      assert.equal(inv.from.id, a.auth.account.id);
      assert.equal(inv.from.email, undefined);
      assert.equal(await a.errCode('friends:invite', { friendId: b.auth.account.id }), 'RATE_LIMITED');
      // A quien no es tu amigo, no
      const c = await loggedIn(srv, 'caro', 'Caro');
      assert.equal(await a.errCode('friends:invite', { friendId: c.auth.account.id }), 'NOT_FRIENDS');

      // Beto se une: Ana lo ve en su sala; ya no se le puede invitar
      const aUpd = a.waitFor('friends:update', (d) => betoOf(d)?.room?.id === roomId);
      await b.ok('room:join', { roomId: inv.roomId });
      assert.equal(betoOf(await aUpd).status, 'online');
      await sleep(5100);
      assert.equal(await a.errCode('friends:invite', { friendId: b.auth.account.id }), 'ALREADY_IN_ROOM');

      // Empieza la partida: jugando y ya no se puede unir
      bUpd = b.waitFor('friends:update', (d) => anaOf(d)?.status === 'playing');
      await a.ok('room:start');
      ana = anaOf(await bUpd);
      assert.equal(ana.room.joinable, false);

      // Beto se desconecta: Ana lo ve desconectado
      const off = a.waitFor('friends:update', (d) => betoOf(d)?.status === 'offline');
      b.socket.disconnect();
      assert.equal(betoOf(await off).room, null);

      // Invitar a alguien desconectado no se puede
      await a.ok('room:leave');
      await a.ok('room:create', { name: 'Otra' });
      assert.equal(await a.errCode('friends:invite', { friendId: b.auth.account.id }), 'FRIEND_OFFLINE');
    } finally {
      await srv.close();
    }
  });
});
