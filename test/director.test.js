import test from 'node:test';
import assert from 'node:assert/strict';
import { BOSS_EVERY, crowdCap, formationPoints, paceFor, planWave, toughnessFor } from '../src/director.js';
import { ENEMIES } from '../src/enemies.js';
import { createWorld, spawnEnemy, step, idleInput } from '../src/sim.js';
import { seededRandom } from '../src/util.js';

test('waves grow, only use unlocked enemies, and introduce new ones on their own', () => {
  const rand = seededRandom(1);
  let lastSize = 0;
  for (let n = 1; n <= 30; n++) {
    const plan = planWave(n, rand);
    for (const group of plan.groups) {
      const def = ENEMIES[group.type];
      if (!def.boss) assert.ok(def.from >= 1 && def.from <= n, `${group.type} on wave ${n}`);
      assert.ok(group.count >= 1);
    }
    const debut = Object.keys(ENEMIES).find(type => ENEMIES[type].from === n);
    if (debut && !plan.boss) assert.equal(plan.groups[0].type, debut);
    const size = plan.groups.reduce((sum, g) => sum + (ENEMIES[g.type].cost || 0) * g.count, 0);
    if (!plan.boss && n % BOSS_EVERY !== 1) assert.ok(size >= lastSize * 0.8, `wave ${n} shrank`);
    if (!plan.boss) lastSize = size;
  }
});

test('every eighth wave brings the Warden', () => {
  const rand = seededRandom(2);
  for (let n = 1; n <= 24; n++) {
    const wardens = planWave(n, rand).groups.filter(g => g.type === 'warden').length;
    assert.equal(wardens, n % BOSS_EVERY === 0 ? 1 : 0, `wave ${n}`);
  }
});

test('formations stay inside the arena and keep their distance from the player', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const w = createWorld({ seed, portrait: seed % 2 === 0 });
    w.player.x = 20 + w.rand() * (w.arena.w - 40);
    w.player.y = 20 + w.rand() * (w.arena.h - 40);
    for (const formation of ['cluster', 'corners', 'edge', 'ring', 'center']) {
      for (const [x, y] of formationPoints(formation, 8, w)) {
        assert.ok(x >= 0 && x <= w.arena.w && y >= 0 && y <= w.arena.h, `${formation} outside the arena`);
        assert.ok(Math.hypot(x - w.player.x, y - w.player.y) >= 250, `${formation} too close to the player`);
      }
    }
  }
});

test('early waves are slow and gentle; health grows only slowly until the late game', () => {
  assert.ok(paceFor(1) < 0.85 && paceFor(8) >= 1);
  assert.equal(toughnessFor(8), 1);
  assert.ok(toughnessFor(20) < 1.8, 'wave 20 enemies take less than twice the hits');
  assert.ok(toughnessFor(25) < 2.1);
  assert.ok(toughnessFor(45) > 10, 'the late game still ends every run');
  for (let n = 1; n < 80; n++) {
    assert.ok(toughnessFor(n + 1) >= toughnessFor(n));
    assert.ok(paceFor(n + 1) > paceFor(n));
  }
});

test('new groups wait while the arena is at the crowd cap', () => {
  const w = createWorld({ seed: 4 });
  w.wave = 9; // the next wave is 10
  w.director.t = 0;
  const cap = crowdCap(10);
  for (let i = 0; i < cap; i++) spawnEnemy(w, 'mote', 60 + (i % 20) * 70, 60 + Math.floor(i / 20) * 70, { spawnT: 99 });
  for (let t = 0; t < 20; t += 1 / 60) { step(w, idleInput(), 1 / 60); w.events.length = 0; }
  assert.equal(w.wave, 10);
  assert.equal(w.enemies.length, cap, 'nothing new came in');
  w.enemies.length = cap - 10;
  for (let t = 0; t < 3; t += 1 / 60) { step(w, idleInput(), 1 / 60); w.events.length = 0; }
  assert.ok(w.enemies.length > cap - 10, 'groups resume once there is room');
});
