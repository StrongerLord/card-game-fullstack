// Emotes rápidos, reacciones de los bots y marcador de victorias de la sala.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, sleep } from './helpers.js';
import { reactionsFor, replyTo } from '../src/botTalk.js';

const profile = (name) => ({ name, avatar: 0, color: '#885ffe' });
const always = () => 0; // con azar 0 siempre reacciona y siempre elige el primero

describe('Emotes', () => {
  test('room:emote se difunde a la sala; uno inválido o fuera de sala se rechaza', async () => {
    const srv = await startServer({ botReactions: false });
    try {
      const a = await srv.client({ profile: profile('Ana') });
      const b = await srv.client({ profile: profile('Beto') });
      assert.equal(await a.errCode('room:emote', { emote: 'angry' }), 'NOT_IN_ROOM');
      const { roomId } = await a.ok('room:create', { name: 'Emotes' });
      await b.ok('room:join', { roomId });
      const got = b.waitFor('room:emote');
      await a.ok('room:emote', { emote: 'rage' });
      const e = await got;
      assert.equal(e.playerId, a.session.playerId);
      assert.equal(e.emote, 'rage');
      assert.equal(e.say, undefined);
      assert.equal(await a.errCode('room:emote', { emote: 'toString' }), 'BAD_PAYLOAD');
      assert.equal(await a.errCode('room:emote', { emote: 5 }), 'BAD_PAYLOAD');
      // No quedan en el historial del chat
      assert.ok(!a.all('room:chat').some((m) => m.text?.includes('rage')));
    } finally {
      await srv.close();
    }
  });

  test('más de 4 emotes en 3 s → RATE_LIMITED', async () => {
    const srv = await startServer({ botReactions: false });
    try {
      const a = await srv.client({ profile: profile('Ana') });
      await a.ok('room:create', { name: 'Spam' });
      for (let i = 0; i < 4; i++) await a.ok('room:emote', { emote: 'laugh' });
      assert.equal(await a.errCode('room:emote', { emote: 'laugh' }), 'RATE_LIMITED');
    } finally {
      await srv.close();
    }
  });

  test('los bots reaccionan durante la partida con emotes válidos', async () => {
    const srv = await startServer({ turnMs: 25, botMinMs: 1, botMaxMs: 4, botReactMinMs: 1, botReactMaxMs: 5 });
    try {
      const a = await srv.client({ profile: profile('Humano') });
      await a.ok('room:create', { name: 'Bots que hablan' });
      for (let i = 0; i < 3; i++) await a.ok('room:addBot');
      const done = a.waitFor('game:state', (s) => s.winner !== null, { timeout: 60_000 });
      await a.ok('room:start');
      await done;
      await sleep(80);
      const emotes = a.all('room:emote');
      assert.ok(emotes.length > 0, 'ningún bot reaccionó en toda la partida');
      const room = a.all('room:state').at(-1);
      const bots = new Set(room.players.filter((p) => p.isBot).map((p) => p.id));
      for (const e of emotes) {
        assert.ok(bots.has(e.playerId));
        assert.equal(typeof e.emote, 'string');
      }
    } finally {
      await srv.close();
    }
  });
});

describe('Marcador', () => {
  test('wins y gamesPlayed se acumulan entre revanchas', async () => {
    const srv = await startServer({ turnMs: 25, botMinMs: 1, botMaxMs: 4, botReactions: false });
    try {
      const a = await srv.client({ profile: profile('Humano') });
      await a.ok('room:create', { name: 'Liga' });
      await a.ok('room:addBot');
      const first = a.all('room:state').at(-1);
      assert.equal(first.gamesPlayed, 0);
      assert.ok(first.players.every((p) => p.wins === 0));
      for (let game = 1; game <= 2; game++) {
        const fin = a.waitFor('room:state', (s) => s?.status === 'finished' && s.gamesPlayed === game, { timeout: 60_000 });
        await a.ok('room:start');
        const room = await fin;
        assert.equal(room.players.reduce((n, p) => n + p.wins, 0), game);
        const back = a.waitFor('room:state', (s) => s?.status === 'lobby');
        await a.ok('room:rematch');
        assert.equal((await back).gamesPlayed, game);
      }
    } finally {
      await srv.close();
    }
  });
});

describe('botTalk', () => {
  test('al bot que le destruyen un órgano se enoja y el que lo hizo se burla', () => {
    const events = [
      { type: 'played', playerId: 'bot_a', card: { kind: 'virus' } },
      { type: 'organDestroyed', playerId: 'bot_b', slotId: 'c01', cards: [] },
    ];
    const out = reactionsFor(events, ['bot_a', 'bot_b'], always);
    assert.deepEqual(out.map((r) => [r.playerId, r.emote]).sort(), [['bot_a', 'evil'], ['bot_b', 'rage']]);
    assert.ok(out.every((r) => typeof r.say === 'string'));
  });

  test('una reacción por bot (la de más prioridad) y nada para humanos', () => {
    const events = [
      { type: 'played', playerId: 'human' },
      { type: 'infected', playerId: 'bot_b', slotId: 'c01' },
      { type: 'win', playerId: 'human', reason: 'organs' },
    ];
    const out = reactionsFor(events, ['bot_b'], always);
    assert.equal(out.length, 1);
    assert.equal(out[0].emote, 'cry'); // perder pesa más que la infección
    assert.deepEqual(reactionsFor(events, [], always), []);
    assert.deepEqual(reactionsFor(events, ['bot_b'], () => 0.99), []);
  });

  test('replyTo contesta a veces y con un emote válido', () => {
    assert.equal(replyTo('laugh', ['bot_a'], () => 0.9), null);
    assert.deepEqual(replyTo('laugh', ['bot_a'], always), { playerId: 'bot_a', emote: 'angry' });
    assert.equal(replyTo('laugh', [], always), null);
  });
});
