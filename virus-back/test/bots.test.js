// Tests de los bots de la sala: que no se repitan avatar ni color mientras haya de dónde elegir.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from './helpers.js';

describe('Bots', () => {
  let srv;
  before(async () => { srv = await startServer(); });
  after(() => srv.close());

  test('cinco bots con avatares y colores distintos (y distintos al anfitrión)', async () => {
    // Se repite varias veces porque la elección es al azar
    for (let round = 0; round < 8; round++) {
      const a = await srv.client({ profile: { name: `Jefa ${round}`, avatar: 2, color: '#ffae00' } });
      const { roomId } = await a.ok('room:create', { name: `Bots ${round}`, maxPlayers: 6 });
      for (let i = 0; i < 5; i++) await a.ok('room:addBot', { level: i % 2 ? 'easy' : 'normal' });
      const st = await a.waitFor('room:state', (s) => s?.id === roomId && s.players.length === 6, { past: true });
      const avatars = st.players.map((p) => p.avatar);
      const colors = st.players.map((p) => p.color.toLowerCase());
      assert.equal(new Set(avatars).size, 6, `avatares repetidos: ${avatars}`);
      assert.equal(new Set(colors).size, 6, `colores repetidos: ${colors}`);
      await a.ok('room:leave');
      a.socket.disconnect();
    }
  });
});
