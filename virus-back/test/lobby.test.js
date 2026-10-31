// Tests de integración: HTTP, sesión, salas, chat, anfitrión, bots y expulsiones.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers.js';

const profile = (name, avatar = 1, color = '#ff0000') => ({ name, avatar, color });

describe('HTTP', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('GET /health y GET /rooms', async () => {
    const h = await fetch(`${srv.url}/health`).then((r) => r.json());
    assert.deepEqual(h, { ok: true });
    const a = await srv.client({ profile: profile('Ana') });
    const { roomId } = await a.ok('room:create', { name: 'Mesa 1' });
    const rooms = await fetch(`${srv.url}/rooms`).then((r) => r.json());
    assert.equal(rooms.length, 1);
    assert.deepEqual(rooms[0], { id: roomId, name: 'Mesa 1', playerCount: 1, maxPlayers: 6, status: 'lobby', hostName: 'Ana' });
  });
});

describe('Sesión', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('hello sin token crea sesión; con token la recupera', async () => {
    const a = await srv.client({ profile: profile('Vane', 3, '#00FF00') });
    const { token, playerId, profile: p, roomId } = a.session;
    assert.ok(token && playerId);
    assert.deepEqual(p, { name: 'Vane', avatar: 3, color: '#00ff00' });
    assert.equal(roomId, null);
    a.socket.disconnect();

    const b = await srv.client({ token });
    assert.equal(b.session.playerId, playerId);
    assert.equal(b.session.token, token);
    assert.equal(b.session.profile.name, 'Vane');
  });

  test('token desconocido o perfil inválido no rompen el hello', async () => {
    const a = await srv.client({ token: 'no-existe-este-token', profile: { name: 42, avatar: 99, color: 'rojo' } });
    assert.notEqual(a.session.token, 'no-existe-este-token');
    assert.ok(a.session.profile.name.length >= 1);
    assert.ok(a.session.profile.avatar >= 0 && a.session.profile.avatar <= 8);
    assert.match(a.session.profile.color, /^#[0-9a-f]{6}$/);
    // Payloads basura en el hello tampoco lo rompen
    const r = await a.req('session:hello', 'basura');
    assert.equal(r.ok, true);
  });

  test('sin hello, todo pide sesión', async () => {
    const a = await srv.client({ hello: false });
    assert.equal(await a.errCode('room:create', { name: 'x' }), 'NO_SESSION');
    // rooms:list no necesita sesión
    const r = await a.ok('rooms:list');
    assert.ok(Array.isArray(r.rooms));
  });

  test('profile:update valida y aplica', async () => {
    const a = await srv.client({ profile: profile('Elian') });
    const r = await a.ok('profile:update', { name: '  Elian  Pro ', avatar: 8, color: '#ABC' });
    assert.deepEqual(r.profile, { name: 'Elian Pro', avatar: 8, color: '#aabbcc' });
    assert.equal(await a.errCode('profile:update', { name: '', avatar: 1, color: '#fff' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', { name: 'x'.repeat(17), avatar: 1, color: '#fff' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', { name: 'Ok', avatar: 9, color: '#fff' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', { name: 'Ok', avatar: 1.5, color: '#fff' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', { name: 'Ok', avatar: 1, color: 'red' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', null), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('profile:update', [1, 2]), 'BAD_PAYLOAD');
  });

  test('otra pestaña con el mismo token reemplaza a la anterior', async () => {
    const a = await srv.client({ profile: profile('Doble') });
    const replaced = a.waitFor('session:replaced');
    const b = await srv.client({ token: a.session.token });
    await replaced;
    assert.equal(b.session.playerId, a.session.playerId);
  });
});

describe('Salas', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('crear, unirse, llenar y errores', async () => {
    const a = await srv.client({ profile: profile('Ana') });
    const b = await srv.client({ profile: profile('Beto') });
    const c = await srv.client({ profile: profile('Caro') });

    const update = c.waitFor('rooms:update', (rs) => rs.some((r) => r.name === 'Duelo'));
    const { roomId } = await a.ok('room:create', { name: '  Duelo ', maxPlayers: 2 });
    assert.match(roomId, /^[A-Z0-9]{5}$/);
    const st = await a.waitFor('room:state', (s) => s?.id === roomId, { past: true });
    assert.equal(st.hostId, a.session.playerId);
    assert.equal(st.status, 'lobby');
    assert.equal(st.players.length, 1);
    assert.deepEqual(st.players[0], { id: a.session.playerId, name: 'Ana', avatar: 1, color: '#ff0000', isBot: false, connected: true, wins: 0 });
    const summary = (await update).find((r) => r.id === roomId);
    assert.equal(summary.playerCount, 1);

    assert.equal(await a.errCode('room:create', { name: 'Otra' }), 'ALREADY_IN_ROOM');
    assert.equal(await b.errCode('room:join', { roomId: 'ZZZZZ' }), 'ROOM_NOT_FOUND');
    assert.equal(await b.errCode('room:join', {}), 'BAD_PAYLOAD');
    assert.equal(await b.errCode('room:join', { roomId: 'x'.repeat(100) }), 'BAD_PAYLOAD');
    assert.equal(await b.errCode('room:join'), 'BAD_PAYLOAD');

    const aSeesB = a.waitFor('room:state', (s) => s?.players.length === 2);
    await b.ok('room:join', { roomId: roomId.toLowerCase() });
    await aSeesB;
    assert.equal(await b.errCode('room:join', { roomId }), 'ALREADY_IN_ROOM');
    assert.equal(await c.errCode('room:join', { roomId }), 'ROOM_FULL');

    // Validaciones de create
    assert.equal(await c.errCode('room:create', { name: 'x'.repeat(25) }), 'BAD_PAYLOAD');
    assert.equal(await c.errCode('room:create', { name: 'ok', maxPlayers: 7 }), 'BAD_PAYLOAD');
    assert.equal(await c.errCode('room:create', { name: 'ok', maxPlayers: 1 }), 'BAD_PAYLOAD');
    assert.equal(await c.errCode('room:create', { name: 'ok', maxPlayers: '4' }), 'BAD_PAYLOAD');
    assert.equal(await c.errCode('room:create', { name: { evil: 1 } }), 'BAD_PAYLOAD');
    // Nombre vacío → nombre por defecto
    const { roomId: r2 } = await c.ok('room:create', { name: '' });
    const s2 = await c.waitFor('room:state', (s) => s?.id === r2, { past: true });
    assert.equal(s2.name, 'Sala de Caro');
    assert.equal(s2.maxPlayers, 6);

    assert.equal(await c.errCode('room:start'), 'NOT_ENOUGH_PLAYERS');
    assert.equal(await b.errCode('room:start'), 'NOT_HOST');
  });

  test('chat: difusión, validación y rate limit', async () => {
    const a = await srv.client({ profile: profile('Lalo', 2, '#123456') });
    const b = await srv.client({ profile: profile('Mimi') });
    const { roomId } = await a.ok('room:create', { name: 'Charla' });
    await b.ok('room:join', { roomId });
    // Al unirse, b recibe el historial (incluye los mensajes de sistema)
    const sys = await b.waitFor('room:chat', (m) => m.system && m.text === 'Lalo creó la sala', { past: true });
    assert.equal(sys.from, null);

    const got = b.waitFor('room:chat', (m) => !m.system && m.text === 'hola  mundo'.replace('  ', ' '));
    await a.ok('room:chat', { text: '  hola   mundo ' });
    const msg = await got;
    assert.deepEqual(msg.from, { id: a.session.playerId, name: 'Lalo', color: '#123456' });
    assert.equal(msg.system, false);
    assert.ok(msg.id && typeof msg.ts === 'number');

    assert.equal(await a.errCode('room:chat', { text: '' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('room:chat', { text: '   ' }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('room:chat', { text: 'x'.repeat(201) }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('room:chat', { text: 5 }), 'BAD_PAYLOAD');
    await a.ok('room:chat', { text: 'x'.repeat(200) });
    // Ya mandó 2; caben 3 más en la ventana de 5 s y el sexto falla
    for (let i = 0; i < 3; i++) await a.ok('room:chat', { text: `m${i}` });
    assert.equal(await a.errCode('room:chat', { text: 'otro' }), 'RATE_LIMITED');
    // El límite es por jugador: b sí puede
    await b.ok('room:chat', { text: 'yo sí' });

    const out = await srv.client({ profile: profile('Fuera') });
    assert.equal(await out.errCode('room:chat', { text: 'hola' }), 'NOT_IN_ROOM');
  });

  test('si el anfitrión sale, pasa al siguiente humano; sala sin humanos se borra', async () => {
    const a = await srv.client({ profile: profile('Host') });
    const b = await srv.client({ profile: profile('Segundo') });
    const { roomId } = await a.ok('room:create', { name: 'Herencia' });
    await a.ok('room:addBot', { level: 'easy' }); // el bot va antes que b
    await b.ok('room:join', { roomId });

    const newHost = b.waitFor('room:state', (s) => s && s.players.length === 2);
    const nullState = a.waitFor('room:state', (s) => s === null);
    await a.ok('room:leave');
    await nullState;
    const st = await newHost;
    assert.equal(st.hostId, b.session.playerId); // humano, no el bot
    await b.waitFor('room:chat', (m) => m.system && m.text === 'Host salió', { past: true });

    // El que se fue puede crear otra sala
    const { roomId: other } = await a.ok('room:create', { name: 'Nueva' });
    assert.ok(other);

    // b sale: sólo queda el bot → la sala se borra
    const gone = a.waitFor('rooms:update', (rs) => !rs.some((r) => r.id === roomId));
    await b.ok('room:leave');
    await gone;
    assert.ok(!srv.server.rooms.rooms.has(roomId));
    // salir sin sala no es error
    await b.ok('room:leave');
  });

  test('addBot, kick y permisos', async () => {
    const a = await srv.client({ profile: profile('Jefa') });
    const b = await srv.client({ profile: profile('Pepe') });
    const { roomId } = await a.ok('room:create', { name: 'Bots', maxPlayers: 4 });
    await b.ok('room:join', { roomId });
    assert.equal(await b.errCode('room:addBot', {}), 'NOT_HOST');
    assert.equal(await a.errCode('room:addBot', { level: 'dios' }), 'BAD_PAYLOAD');
    const { playerId: botId } = await a.ok('room:addBot', { level: 'normal' });
    await a.ok('room:addBot');
    const st = await a.waitFor('room:state', (s) => s?.players.length === 4, { past: true });
    const bots = st.players.filter((p) => p.isBot);
    assert.equal(bots.length, 2);
    for (const bot of bots) {
      assert.ok(bot.name.length > 0);
      assert.ok(bot.avatar >= 0 && bot.avatar <= 8);
      assert.match(bot.color, /^#[0-9a-f]{6}$/);
      assert.equal(bot.connected, true);
    }
    assert.notEqual(bots[0].name, bots[1].name);
    assert.equal(await a.errCode('room:addBot'), 'ROOM_FULL');

    assert.equal(await b.errCode('room:kick', { playerId: botId }), 'NOT_HOST');
    assert.equal(await a.errCode('room:kick', { playerId: a.session.playerId }), 'BAD_PAYLOAD');
    assert.equal(await a.errCode('room:kick', { playerId: 'nadie' }), 'PLAYER_NOT_FOUND');
    assert.equal(await a.errCode('room:kick', { playerId: { $ne: 1 } }), 'BAD_PAYLOAD');
    await a.ok('room:kick', { playerId: botId });
    await a.waitFor('room:state', (s) => s?.players.length === 3, { past: true });

    // Expulsar a un humano: recibe room:state null y queda sin sala
    const kicked = b.waitFor('room:state', (s) => s === null);
    await a.ok('room:kick', { playerId: b.session.playerId });
    await kicked;
    assert.equal(await b.errCode('room:chat', { text: 'hola' }), 'NOT_IN_ROOM');
    await a.waitFor('room:chat', (m) => m.system && m.text === 'Pepe fue expulsado', { past: true });
  });

  test('un cliente que inunda de eventos recibe RATE_LIMITED y el server sigue vivo', async () => {
    const a = await srv.client({ profile: profile('Spam') });
    const results = await Promise.all(Array.from({ length: 60 }, () => a.req('rooms:list')));
    assert.ok(results.some((r) => !r.ok && r.error.code === 'RATE_LIMITED'));
    await sleep(2100);
    await a.ok('rooms:list');
  });
});
