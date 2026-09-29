import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseUpgrade, createWorld, idleInput, ORBITAL, orbitalPositions, spawnEnemy, step } from '../src/sim.js';
import { rollChoices, shipStats, UPGRADES, xpToNext } from '../src/upgrades.js';
import { seededRandom } from '../src/util.js';

const DT = 1 / 60;
const run = (w, seconds, input = idleInput) => {
  const events = [];
  for (let t = 0; t < seconds; t += DT) {
    step(w, typeof input === 'function' ? input(w) : input, DT);
    events.push(...w.events);
    w.events.length = 0;
  }
  return events;
};
const quietWorld = () => {
  const w = createWorld({ seed: 11 });
  w.director.t = Infinity;
  w.player.invuln = 0;
  return w;
};
const aimRight = { ...idleInput(), aimX: 1, fire: true };
// Gives the ship an upgrade directly, as if it had been chosen.
const grant = (w, id, ranks = 1) => {
  for (let i = 0; i < ranks; i++) {
    w.choice = [id];
    chooseUpgrade(w, 0);
  }
  w.events.length = 0;
  w.player.invuln = 0;
};
const shard = (w, x, y) => w.pickups.push({ kind: 'shard', x, y, vx: 0, vy: 0, life: 8, spin: 0 });

test('each level needs more XP than the last', () => {
  for (let level = 1; level < 40; level++) assert.ok(xpToNext(level + 1) > xpToNext(level));
});

test('collecting enough shards offers three different upgrades and freezes the world until one is chosen', () => {
  const w = quietWorld();
  for (let i = 0; i < xpToNext(1); i++) shard(w, w.player.x + 30, w.player.y);
  const events = run(w, 0.3);
  assert.equal(w.level, 2);
  assert.ok(events.some(e => e.type === 'levelUp'));
  assert.equal(w.choice.length, 3);
  assert.equal(new Set(w.choice).size, 3);
  const time = w.time;
  run(w, 1);
  assert.equal(w.time, time, 'nothing moves while choosing');
  const offered = w.choice[1];
  assert.equal(chooseUpgrade(w, 1), true);
  assert.equal(w.upgrades[offered], 1);
  assert.equal(w.choice, null);
  assert.equal(chooseUpgrade(w, 0), false, 'nothing left to choose');
  run(w, 0.1);
  assert.ok(w.time > time);
});

test('offers never include maxed-out upgrades, and Salvage fills in when few are left', () => {
  const rand = seededRandom(3);
  const ranks = Object.fromEntries(Object.entries(UPGRADES).filter(([, u]) => !u.filler).map(([id, u]) => [id, u.max]));
  ranks.rapid = 4; // one rank left
  for (let i = 0; i < 20; i++) assert.deepEqual(rollChoices(ranks, rand), ['rapid', 'salvage']);
  for (let i = 0; i < 200; i++) {
    const offer = rollChoices({ ram: 1, shield: 3 }, rand);
    assert.equal(offer.length, 3);
    assert.ok(!offer.includes('ram') && !offer.includes('shield') && !offer.includes('salvage'));
  }
});

test('Salvage gives a bomb instead of a rank', () => {
  const w = quietWorld();
  w.choice = ['salvage'];
  chooseUpgrade(w, 0);
  assert.equal(w.bombs, 4);
  assert.deepEqual(w.upgrades, {});
});

test('Multishot and Tail Guns add bullets to every volley', () => {
  const volley = setup => {
    const w = quietWorld();
    setup(w);
    step(w, aimRight, DT);
    return w.bullets;
  };
  assert.equal(volley(() => {}).length, 2);
  assert.equal(volley(w => grant(w, 'multishot', 2)).length, 4);
  const tail = volley(w => grant(w, 'tailgun', 2));
  assert.equal(tail.length, 5);
  assert.ok(tail.some(b => b.vx < -800), 'one bullet flies backward');
});

test('Rapid Fire shoots faster', () => {
  const count = setup => {
    const w = quietWorld();
    setup(w);
    return run(w, 2, aimRight).filter(e => e.type === 'shoot').length;
  };
  const base = count(() => {});
  const rapid = count(w => grant(w, 'rapid', 5));
  assert.ok(rapid >= base * 1.7, `${base} → ${rapid}`);
});

test('Heavy Rounds hit harder and Piercing Rounds pass through enemies', () => {
  const w = quietWorld();
  grant(w, 'heavy', 2);
  grant(w, 'pierce', 1);
  const near = spawnEnemy(w, 'spitter', w.player.x + 150, w.player.y, { spawnT: 0, pace: 0, hpScale: 0.5 });
  const far = spawnEnemy(w, 'spitter', w.player.x + 300, w.player.y, { spawnT: 0, pace: 0, hpScale: 0.5 });
  step(w, { ...aimRight, aimY: 0 }, DT);
  run(w, 0.3);
  assert.ok(near.dead && far.dead, 'one volley of heavy bullets went through both 2-hp enemies');
});

test('Ricochet bounces bullets off the walls', () => {
  const w = quietWorld();
  grant(w, 'ricochet');
  w.player.x = w.arena.w - 60;
  step(w, aimRight, DT);
  const events = run(w, 0.15);
  assert.ok(events.some(e => e.type === 'wallHit'));
  assert.ok(w.bullets.length > 0 && w.bullets.every(b => b.vx < 0), 'the bullets came back');
});

test('Orbitals circle the ship and shred enemies they touch', () => {
  const w = quietWorld();
  grant(w, 'orbitals', 2);
  const orbs = orbitalPositions(w);
  assert.equal(orbs.length, 2);
  for (const [x, y] of orbs) assert.ok(Math.abs(Math.hypot(x - w.player.x, y - w.player.y) - ORBITAL.radius) < 1e-6);
  const e = spawnEnemy(w, 'mote', orbs[0][0], orbs[0][1], { spawnT: 0, pace: 0 });
  run(w, 0.05);
  assert.ok(e.dead);
});

test('the Deflector absorbs a hit, then recharges', () => {
  const w = quietWorld();
  grant(w, 'shield');
  assert.equal(w.player.shield, true);
  spawnEnemy(w, 'seeker', w.player.x, w.player.y, { spawnT: 0 });
  const events = run(w, 0.1);
  assert.ok(events.some(e => e.type === 'shieldBreak'));
  assert.equal(w.player.alive, true);
  assert.equal(w.lives, 3);
  assert.equal(w.player.shield, false);
  w.enemies.length = 0;
  const later = run(w, shipStats({ shield: 1 }).shieldTime + 0.5);
  assert.ok(later.some(e => e.type === 'shieldUp'));
  assert.equal(w.player.shield, true);
});

test('a Ram Dash damages what it passes through', () => {
  const w = quietWorld();
  grant(w, 'ram');
  const e = spawnEnemy(w, 'splitter', w.player.x + 90, w.player.y, { spawnT: 0, pace: 0 });
  run(w, 0.15, w => ({ ...idleInput(), moveX: 1, dash: w.time < DT * 1.5 }));
  assert.ok(e.dead);
  assert.equal(w.player.alive, true);
});

test('upgrades stay after losing a life', () => {
  const w = quietWorld();
  grant(w, 'multishot', 2);
  spawnEnemy(w, 'seeker', w.player.x, w.player.y, { spawnT: 0 });
  run(w, 3);
  assert.equal(w.lives, 2);
  assert.equal(w.upgrades.multishot, 2);
  assert.equal(w.stats.streams, 4);
});
