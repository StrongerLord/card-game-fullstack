// Estimación de lo que tarda la mesa en animar un lote (el bot "piensa" y el reloj corre después)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { estimateAnimationMs } from '../src/gameRunner.js';

const treat = (t) => ({ type: 'played', playerId: 'b', card: { kind: 'treatment', treatment: t } });

describe('estimateAnimationMs', () => {
  test('un lote sólo con el turno no se anima', () => {
    assert.equal(estimateAnimationMs([{ type: 'turn', playerId: 'a' }]), 0);
  });

  test('cura + rebarajeo + robo: más de 3.5 s (el cliente tarda ~3.7 s)', () => {
    const ms = estimateAnimationMs([
      { type: 'played', playerId: 'b', card: { kind: 'medicine' } }, { type: 'cured', playerId: 'b', slotId: 's' },
      { type: 'reshuffled', count: 40 }, { type: 'drew', playerId: 'b', count: 1 }, { type: 'turn', playerId: 'a' },
    ]);
    assert.ok(ms >= 3500 && ms <= 4500, String(ms));
  });

  test('guante a 3 jugadores: robos y sellos en serie (~7 s), sin el tope viejo de 2.2 s', () => {
    const ev = [treat('glove'), { type: 'handsDiscarded', playerIds: ['a', 'c', 'd'] }, { type: 'drew', playerId: 'b', count: 1 }];
    for (const p of ['a', 'c', 'd']) ev.push({ type: 'turn', playerId: p }, { type: 'turnSkipped', playerId: p }, { type: 'drew', playerId: p, count: 3 });
    ev.push({ type: 'turn', playerId: 'b' });
    const bots = estimateAnimationMs(ev);
    assert.ok(bots >= 6500 && bots <= 9000, String(bots));
    // El sello de un humano dura más
    assert.ok(estimateAnimationMs(ev, { isHuman: (p) => p === 'a' }) > bots);
  });

  test('tiene tope', () => {
    const ev = [treat('glove'), { type: 'handsDiscarded', playerIds: ['a', 'c', 'd', 'e', 'f'] }];
    for (let i = 0; i < 12; i++) ev.push({ type: 'reshuffled', count: 10 });
    assert.equal(estimateAnimationMs(ev), 9000);
  });
});
