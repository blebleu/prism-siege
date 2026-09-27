import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorld, idleInput, spawnEnemy, step } from '../src/sim.js';
import { botInput } from '../src/bot.js';

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
// A world with the wave director parked, so tests place their own enemies.
const quietWorld = (options) => {
  const w = createWorld({ seed: 7, ...options });
  w.director.t = Infinity;
  w.player.invuln = 0;
  return w;
};
const aimRight = { ...idleInput(), aimX: 1, fire: true };

test('the first wave arrives shortly after the start, away from the player', () => {
  const w = createWorld({ seed: 3 });
  assert.equal(w.wave, 0);
  run(w, 1.5);
  assert.equal(w.wave, 1);
  assert.ok(w.enemies.length > 0);
  for (const e of w.enemies) assert.ok(Math.hypot(e.x - w.player.x, e.y - w.player.y) >= 300, 'spawned too close');
});

test('enemies can’t hurt the player while they are still materializing', () => {
  const w = quietWorld();
  spawnEnemy(w, 'seeker', w.player.x, w.player.y);
  step(w, idleInput(), DT);
  assert.equal(w.player.alive, true);
  run(w, 1);
  assert.equal(w.player.alive, false);
});

test('shooting an enemy scores points and drops shards that raise the multiplier', () => {
  const w = quietWorld();
  const e = spawnEnemy(w, 'mote', w.player.x + 200, w.player.y, { spawnT: 0 });
  e.pace = 0;
  const events = run(w, 0.5, aimRight);
  assert.ok(events.some(ev => ev.type === 'kill' && ev.enemy === 'mote'));
  assert.equal(w.score, 25);
  const shards = w.pickups.filter(k => k.kind === 'shard');
  assert.ok(shards.length >= 1);
  // Fly over the shards: the magnet pulls them in.
  run(w, 1.5, { ...idleInput(), moveX: 1 });
  assert.equal(w.mult, 1 + shards.length);
});

test('points are multiplied by the multiplier', () => {
  const w = quietWorld();
  w.mult = 10;
  spawnEnemy(w, 'seeker', w.player.x + 200, w.player.y, { spawnT: 0, pace: 0 });
  run(w, 0.5, aimRight);
  assert.equal(w.score, 500);
});

test('a splitter bursts into three splinters', () => {
  const w = quietWorld();
  spawnEnemy(w, 'splitter', w.player.x + 300, w.player.y, { spawnT: 0, pace: 0 });
  let splinters = 0;
  for (let t = 0; t < 1 && !splinters; t += DT) {
    step(w, aimRight, DT);
    w.events.length = 0;
    splinters = w.enemies.filter(e => e.type === 'splinter').length;
  }
  assert.equal(splinters, 3);
});

test('getting hit costs a life, resets the multiplier and clears the arena, then the player respawns', () => {
  const w = quietWorld();
  w.mult = 40;
  spawnEnemy(w, 'mote', 200, 200);
  spawnEnemy(w, 'seeker', w.player.x, w.player.y, { spawnT: 0 });
  const events = run(w, 0.1);
  assert.ok(events.some(ev => ev.type === 'playerDeath'));
  assert.equal(w.lives, 2);
  assert.equal(w.mult, 1);
  assert.equal(w.enemies.length, 0);
  assert.equal(w.score, 0, 'clearing the arena on death scores nothing');
  const later = run(w, 2);
  assert.ok(later.some(ev => ev.type === 'respawn'));
  assert.equal(w.player.alive, true);
  assert.ok(w.player.invuln > 0);
});

test('the game ends when the last life is lost', () => {
  const w = quietWorld({ lives: 1 });
  spawnEnemy(w, 'seeker', w.player.x, w.player.y, { spawnT: 0 });
  const events = run(w, 3);
  assert.equal(w.over, true);
  assert.equal(events.filter(ev => ev.type === 'gameOver').length, 1);
  const time = w.time;
  run(w, 1);
  assert.equal(w.time, time, 'a finished game stays finished');
});

test('dashing passes through enemies unharmed and has a cooldown', () => {
  const w = quietWorld();
  spawnEnemy(w, 'splitter', w.player.x + 80, w.player.y, { spawnT: 0, pace: 0 });
  const events = run(w, 0.15, w => ({ ...idleInput(), moveX: 1, dash: w.time < DT * 1.5 }));
  assert.equal(events.filter(ev => ev.type === 'dash').length, 1);
  assert.equal(w.player.alive, true);
  assert.ok(w.player.x > w.arena.w / 2 + 120, 'the dash carried the ship past the enemy');
  run(w, 0.1, { ...idleInput(), dash: true });
  assert.ok(w.player.dashCd > 0);
});

test('a bomb wipes the arena, scores the kills and uses up one bomb', () => {
  const w = quietWorld();
  for (let i = 0; i < 5; i++) spawnEnemy(w, 'mote', 100 + i * 300, 100, { spawnT: 0, pace: 0 });
  const events = run(w, 1.2, w => ({ ...idleInput(), bomb: w.time < DT * 1.5 }));
  assert.equal(w.bombs, 2);
  assert.equal(w.enemies.length, 0);
  assert.equal(w.score, 125);
  assert.equal(events.filter(ev => ev.type === 'bomb').length, 1);
});

test('score thresholds award extra lives and bombs', () => {
  const w = quietWorld();
  w.mult = 150;
  w.score = 199990;
  spawnEnemy(w, 'mote', w.player.x + 200, w.player.y, { spawnT: 0, pace: 0 });
  const events = run(w, 0.5, aimRight);
  assert.ok(events.some(ev => ev.type === 'extraLife'));
  assert.ok(events.some(ev => ev.type === 'extraBomb'));
  assert.equal(w.lives, 4);
  assert.equal(w.bombs, 4);
});

test('the same seed and inputs replay exactly', () => {
  const a = createWorld({ seed: 99 }), b = createWorld({ seed: 99 });
  run(a, 40, botInput);
  run(b, 40, botInput);
  assert.equal(a.score, b.score);
  assert.equal(a.wave, b.wave);
  assert.deepEqual(a.enemies.map(e => [e.type, e.x, e.y]), b.enemies.map(e => [e.type, e.x, e.y]));
});

test('the autopilot clears the opening waves, and long games stay numerically sound', () => {
  const w = createWorld({ seed: 5 });
  run(w, 90, botInput);
  assert.ok(w.wave >= 5, `reached wave ${w.wave}`);
  assert.ok(w.kills > 50);
  run(w, 400, botInput);
  for (const thing of [w.player, ...w.enemies, ...w.bullets, ...w.shots, ...w.pickups]) {
    assert.ok(Number.isFinite(thing.x) && Number.isFinite(thing.y));
  }
});
