// The wave director: builds each wave from a point budget, spawns it in groups and formations over time, and
// starts the next wave once the arena is (nearly) clear. Every eighth wave is a boss wave.
import { ENEMIES } from './enemies.js';
import { clamp, TAU } from './util.js';

export const BOSS_EVERY = 8;
const REST = 1.6;
const MARGIN = 60;
const SAFE_DISTANCE = 380;

// How many of one type come in a group, before the budget caps it.
const GROUP_SIZE = { mote: [4, 10], seeker: [3, 8], dodger: [2, 5], splitter: [1, 3], charger: [1, 3], spitter: [1, 2] };
const FORMATIONS = { mote: ['cluster', 'corners', 'edge'], seeker: ['cluster', 'corners', 'edge', 'ring'], dodger: ['cluster', 'corners'], splitter: ['cluster', 'corners'], charger: ['corners', 'edge'], spitter: ['corners', 'edge'] };

export const isBossWave = n => n > 0 && n % BOSS_EVERY === 0;
// Enemies get a little faster each wave, up to 35% faster.
export const paceFor = n => 1 + Math.min(0.35, (n - 1) * 0.018);

export function createDirector() {
  return { state: 'rest', t: 1.2, plan: null, elapsed: 0, next: 0 };
}

// The list of groups for wave n: [{ type, count, formation, at }], `at` in seconds from the wave's start.
export function planWave(n, rand) {
  const pick = list => list[Math.floor(rand() * list.length)];
  const groups = [];
  let budget = Math.floor(8 + n * 5 + n * n * 0.15);
  if (isBossWave(n)) {
    groups.push({ type: 'warden', count: 1, formation: 'center', at: 0.5 });
    budget = Math.floor(budget / 3);
  }
  const unlocked = Object.keys(ENEMIES).filter(type => ENEMIES[type].from && ENEMIES[type].from <= n);
  // A type's first wave opens with a group of it, so the player meets it on its own.
  const debut = unlocked.find(type => ENEMIES[type].from === n);
  while (budget > 0) {
    const affordable = unlocked.filter(type => ENEMIES[type].cost <= budget);
    if (!affordable.length) break;
    const type = groups.length === 0 && debut ? debut : pick(affordable);
    const { cost } = ENEMIES[type];
    const [low, high] = GROUP_SIZE[type];
    const wanted = low + Math.floor(rand() * (high - low + 1)) + Math.floor(n / 4);
    const count = Math.max(1, Math.min(wanted, Math.floor(budget / cost)));
    const formations = FORMATIONS[type].filter(f => f !== 'ring' || n >= 5);
    groups.push({ type, count, formation: pick(formations), at: 0 });
    budget -= count * cost;
  }
  const gap = Math.max(0.5, 2.2 - n * 0.08);
  groups.forEach((group, i) => { if (group.type !== 'warden') group.at = 0.3 + i * gap; });
  return { n, boss: isBossWave(n), groups };
}

// Spawn points for a group, kept inside the arena and away from the player.
export function formationPoints(formation, count, w) {
  const { rand, arena, player } = w;
  const px = player.x, py = player.y;
  const inside = (x, y) => [clamp(x, MARGIN, arena.w - MARGIN), clamp(y, MARGIN, arena.h - MARGIN)];
  const farPoint = () => {
    for (let tries = 0; tries < 16; tries++) {
      const x = MARGIN + rand() * (arena.w - MARGIN * 2), y = MARGIN + rand() * (arena.h - MARGIN * 2);
      if (Math.hypot(x - px, y - py) >= SAFE_DISTANCE) return [x, y];
    }
    return [px < arena.w / 2 ? arena.w - MARGIN * 2 : MARGIN * 2, py < arena.h / 2 ? arena.h - MARGIN * 2 : MARGIN * 2];
  };
  const points = [];
  if (formation === 'center') {
    const cx = arena.w / 2, cy = arena.h / 2;
    points.push(Math.hypot(px - cx, py - cy) < SAFE_DISTANCE ? [px < cx ? arena.w - 260 : 260, cy] : [cx, cy]);
  } else if (formation === 'corners') {
    const corners = [[MARGIN, MARGIN], [arena.w - MARGIN, MARGIN], [MARGIN, arena.h - MARGIN], [arena.w - MARGIN, arena.h - MARGIN]]
      .filter(([x, y]) => Math.hypot(x - px, y - py) >= SAFE_DISTANCE);
    for (let i = 0; i < count; i++) {
      const [x, y] = corners[i % corners.length];
      points.push(inside(x + (rand() - 0.5) * 90, y + (rand() - 0.5) * 90));
    }
  } else if (formation === 'edge') {
    // Along whichever long or short edge is farthest from the player.
    const edges = [
      { d: py, line: t => [t * arena.w, MARGIN] },
      { d: arena.h - py, line: t => [t * arena.w, arena.h - MARGIN] },
      { d: px, line: t => [MARGIN, t * arena.h] },
      { d: arena.w - px, line: t => [arena.w - MARGIN, t * arena.h] }
    ].sort((a, b) => b.d - a.d);
    const edge = edges[Math.floor(rand() * 2)];
    for (let i = 0; i < count; i++) points.push(inside(...edge.line((i + 0.5) / count)));
  } else if (formation === 'ring') {
    const start = rand() * TAU;
    for (let i = 0; i < count; i++) {
      const a = start + (i / count) * TAU;
      const [x, y] = inside(px + Math.cos(a) * 440, py + Math.sin(a) * 440);
      points.push(Math.hypot(x - px, y - py) >= 300 ? [x, y] : farPoint());
    }
  } else {
    const [cx, cy] = farPoint();
    const spread = 30 + count * 8;
    for (let i = 0; i < count; i++) {
      const a = rand() * TAU, d = Math.sqrt(rand()) * spread;
      points.push(inside(cx + Math.cos(a) * d, cy + Math.sin(a) * d));
    }
  }
  return points;
}

// Advances the director one tick. `act.spawn(type, x, y, options)` adds an enemy; `act.emit(event)` reports.
export function updateDirector(w, dt, act) {
  const d = w.director;
  if (!w.player.alive) return; // the wave waits while the player respawns
  if (d.state === 'rest') {
    d.t -= dt;
    if (d.t > 0) return;
    w.wave += 1;
    d.plan = planWave(w.wave, w.rand);
    d.state = 'wave';
    d.elapsed = 0;
    d.next = 0;
    act.emit({ type: 'wave', n: w.wave, boss: d.plan.boss });
    return;
  }
  d.elapsed += dt;
  const { groups } = d.plan;
  while (d.next < groups.length && groups[d.next].at <= d.elapsed) {
    const group = groups[d.next++];
    const bossIndex = Math.floor(w.wave / BOSS_EVERY);
    const options = { pace: paceFor(w.wave), hpScale: group.type === 'warden' ? 1 + (bossIndex - 1) * 0.5 : 1 };
    for (const [x, y] of formationPoints(group.formation, group.count, w)) act.spawn(group.type, x, y, options);
  }
  if (d.next < groups.length) return;
  const bossAlive = w.enemies.some(e => ENEMIES[e.type].boss);
  const lastAt = groups.length ? groups[groups.length - 1].at : 0;
  const leftover = w.wave < 3 ? 0 : Math.min(4, Math.floor(w.wave / 3));
  const cleared = !bossAlive && (w.enemies.length <= leftover || d.elapsed > lastAt + 25);
  if (cleared) {
    d.state = 'rest';
    d.t = REST;
    act.emit({ type: 'waveClear', n: w.wave });
  }
}
