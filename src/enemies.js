// Every enemy type: its numbers, and how it moves and attacks each tick. Behaviours only steer (set velocity,
// angle and their own timers) and ask the world to do things through `act`; the simulation moves them, keeps
// them in the arena and handles collisions.
import { angleDiff, approach, TAU } from './util.js';

// cost: how much of a wave's budget one enemy uses. from: the first wave it can appear in (0 = never picked by
// the wave builder; spawned by something else).
export const ENEMIES = {
  mote:     { r: 14, hp: 1,   points: 25,   shards: 1,  cost: 1, from: 1, color: '#b77dff' },
  seeker:   { r: 13, hp: 1,   points: 50,   shards: 1,  cost: 2, from: 1, color: '#4cc9f0' },
  dodger:   { r: 14, hp: 1,   points: 100,  shards: 2,  cost: 3, from: 3, color: '#5cf2b0' },
  splitter: { r: 20, hp: 3,   points: 100,  shards: 1,  cost: 4, from: 4, color: '#ff4fa3' },
  splinter: { r: 9,  hp: 1,   points: 50,   shards: 1,  cost: 0, from: 0, color: '#ff7cc0' },
  charger:  { r: 15, hp: 2,   points: 120,  shards: 2,  cost: 4, from: 5, color: '#ff9e3d' },
  spitter:  { r: 18, hp: 4,   points: 150,  shards: 3,  cost: 5, from: 6, color: '#ffd23f' },
  warden:   { r: 62, hp: 260, points: 5000, shards: 40, cost: 0, from: 0, color: '#ff3b5c', boss: true }
};

const toward = (e, x, y) => {
  const dx = x - e.x, dy = y - e.y, d = Math.hypot(dx, dy) || 1;
  return [dx / d, dy / d, d];
};

// Where enemies head: the player, or the middle of the arena while the player is respawning.
const targetOf = w => w.player.alive ? w.player : { x: w.arena.w / 2, y: w.arena.h / 2 };

function steer(e, dx, dy, speed, rate, dt) {
  e.vx = approach(e.vx, dx * speed, rate, dt);
  e.vy = approach(e.vy, dy * speed, rate, dt);
}

export const BEHAVIOURS = {
  // Drifts on a random walk and bounces off the walls. Harmless alone, dangerous in swarms.
  mote(e, w, dt) {
    e.heading += (w.rand() - 0.5) * 7 * dt;
    steer(e, Math.cos(e.heading), Math.sin(e.heading), 105 * e.pace, 3, dt);
    e.spin += dt * 3.2;
  },

  // Homes straight in, weaving slightly.
  seeker(e, w, dt) {
    const target = targetOf(w);
    const [nx, ny] = toward(e, target.x, target.y);
    const weave = Math.sin(e.t * 5 + e.phase) * 0.35;
    steer(e, nx - ny * weave, ny + nx * weave, (w.player.alive ? 235 : 60) * e.pace, 3.2, dt);
    e.angle = Math.atan2(e.vy, e.vx);
  },

  // Homes in, and side-steps bullets that are about to hit it (with a cooldown, so it can be caught).
  dodger(e, w, dt) {
    e.dodgeT -= dt;
    e.dodgeCd -= dt;
    e.spin += dt * 2;
    if (e.dodgeT > 0) return;
    const target = targetOf(w);
    const [nx, ny] = toward(e, target.x, target.y);
    steer(e, nx, ny, (w.player.alive ? 200 : 60) * e.pace, 3, dt);
    if (e.dodgeCd > 0) return;
    for (const b of w.bullets) {
      const dx = e.x - b.x, dy = e.y - b.y;
      if (dx * dx + dy * dy > 170 * 170) continue;
      const speed = Math.hypot(b.vx, b.vy) || 1;
      const along = (dx * b.vx + dy * b.vy) / speed;
      const px = -b.vy / speed, py = b.vx / speed;
      const side = dx * px + dy * py;
      if (along <= 0 || Math.abs(side) > e.r + 24) continue;
      const sign = side >= 0 ? 1 : -1;
      e.vx = px * sign * 560 * e.pace;
      e.vy = py * sign * 560 * e.pace;
      e.dodgeT = 0.18;
      e.dodgeCd = 0.6;
      break;
    }
  },

  // Slow and tough; bursts into three splinters when destroyed (see killEnemy in sim.js).
  splitter(e, w, dt) {
    const target = targetOf(w);
    const [nx, ny] = toward(e, target.x, target.y);
    steer(e, nx, ny, (w.player.alive ? 125 : 40) * e.pace, 2, dt);
    e.spin += dt * 1.4;
  },

  // Fast, circling approach.
  splinter(e, w, dt) {
    const target = targetOf(w);
    const [nx, ny] = toward(e, target.x, target.y);
    const orbit = Math.sin(e.t * 4 + e.phase) * 0.9;
    const dx = nx - ny * orbit, dy = ny + nx * orbit, d = Math.hypot(dx, dy) || 1;
    steer(e, dx / d, dy / d, (w.player.alive ? 275 : 80) * e.pace, 4, dt);
    e.spin += dt * 6;
  },

  // Creeps closer, stops to aim (telegraphed), then charges in a straight line until a wall or its timer stops it.
  charger(e, w, dt, act) {
    const target = targetOf(w);
    e.stateT -= dt;
    if (e.state === 'roam') {
      const [nx, ny] = toward(e, target.x, target.y);
      steer(e, nx, ny, 85 * e.pace, 2, dt);
      e.angle += angleDiff(e.angle, Math.atan2(ny, nx)) * Math.min(1, dt * 4);
      if (e.stateT <= 0 && w.player.alive) { e.state = 'aim'; e.stateT = 0.7; }
    } else if (e.state === 'aim') {
      steer(e, 0, 0, 0, 8, dt);
      const [nx, ny] = toward(e, target.x, target.y);
      e.angle += angleDiff(e.angle, Math.atan2(ny, nx)) * Math.min(1, dt * 10);
      if (e.stateT <= 0) {
        e.state = 'charge';
        e.stateT = 0.8;
        e.vx = Math.cos(e.angle) * 880 * e.pace;
        e.vy = Math.sin(e.angle) * 880 * e.pace;
        act.emit({ type: 'charge', x: e.x, y: e.y, angle: e.angle });
      }
    } else if (e.stateT <= 0 || e.hitWall) {
      e.state = 'roam';
      e.stateT = 1.1 + w.rand() * 0.9;
      e.vx *= 0.2;
      e.vy *= 0.2;
    }
  },

  // Keeps its distance and lobs slow orbs at the player, glowing brighter just before each shot.
  spitter(e, w, dt, act) {
    const target = targetOf(w);
    const [nx, ny, d] = toward(e, target.x, target.y);
    const inOut = d > 430 ? 1 : d < 330 ? -1 : 0;
    steer(e, nx * inOut - ny * 0.6, ny * inOut + nx * 0.6, 95 * e.pace, 2, dt);
    e.spin += dt * 0.8;
    e.fireT -= dt;
    if (e.fireT > 0) return;
    e.fireT = 2.6 - Math.min(0.9, w.wave * 0.03) + w.rand() * 0.4;
    if (!w.player.alive || d > 950) return;
    const aim = Math.atan2(ny, nx);
    const count = w.wave >= 10 ? 3 : 1;
    for (let i = 0; i < count; i++) act.shoot(e.x, e.y, aim + (i - (count - 1) / 2) * 0.24, 240 + Math.min(120, w.wave * 4));
  },

  // The boss: circles the arena, fires rings of orbs, calls in seekers, and gets angrier below half health.
  warden(e, w, dt, act) {
    const cx = w.arena.w / 2 + Math.cos(e.t * 0.23) * 330;
    const cy = w.arena.h / 2 + Math.sin(e.t * 0.31) * 190;
    const [nx, ny, d] = toward(e, cx, cy);
    steer(e, nx, ny, Math.min(80, d), 1.5, dt);
    const enraged = e.hp < e.maxHp / 2;
    e.spin += dt * (enraged ? 1.3 : 0.6);
    e.burstT -= dt;
    e.summonT -= dt;
    e.aimT -= dt;
    if (e.burstT <= 0) {
      const count = enraged ? 20 : 14;
      e.burstPhase += 0.37;
      for (let i = 0; i < count; i++) act.shoot(e.x, e.y, e.burstPhase + (i / count) * TAU, enraged ? 230 : 190);
      e.burstT = enraged ? 2.3 : 3.2;
    }
    if (e.summonT <= 0) {
      for (let i = 0; i < 3; i++) {
        const a = e.spin + (i / 3) * TAU;
        act.spawn('seeker', e.x + Math.cos(a) * (e.r + 40), e.y + Math.sin(a) * (e.r + 40));
      }
      e.summonT = enraged ? 5 : 7;
    }
    if (enraged && e.aimT <= 0 && w.player.alive) {
      const [px, py] = toward(e, w.player.x, w.player.y);
      const aim = Math.atan2(py, px);
      for (let i = -1; i <= 1; i++) act.shoot(e.x, e.y, aim + i * 0.18, 320);
      e.aimT = 1.4;
    }
  }
};

// A new enemy of the given type. `pace` scales its speed with the wave.
export function makeEnemy(type, x, y, rand, { pace = 1, hpScale = 1, spawnT = 0.8 } = {}) {
  const def = ENEMIES[type];
  const hp = def.hp * hpScale;
  return {
    type, x, y, vx: 0, vy: 0, r: def.r, hp, maxHp: hp, pace,
    spawnT: def.boss ? 1.8 : spawnT, t: 0, flash: 0, hitWall: false,
    angle: rand() * TAU, heading: rand() * TAU, spin: rand() * TAU, phase: rand() * TAU,
    dodgeT: 0, dodgeCd: 0, state: 'roam', stateT: 1 + rand(),
    fireT: 1.5 + rand() * 1.5, burstT: 2.5, summonT: 5, aimT: 2, burstPhase: 0
  };
}
