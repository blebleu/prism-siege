// The game itself, with no drawing or DOM: a world object advanced by step(world, input, dt). Everything random
// comes from the world's seeded generator, so tests can replay a game exactly. What happened during a step
// (shots, kills, pickups, deaths) is pushed onto world.events for the renderer and sound to react to.
import { BEHAVIOURS, ENEMIES, makeEnemy } from './enemies.js';
import { createDirector, updateDirector } from './director.js';
import { approach, clamp, seededRandom, TAU } from './util.js';

export const ARENA = { w: 1600, h: 1000 };

export const PLAYER = {
  r: 9,              // hit radius (the ship is drawn larger; a forgiving hitbox feels fair)
  speed: 430,
  grip: 14,          // how quickly the ship reaches its target speed
  dashSpeed: 1250,
  dashTime: 0.15,
  dashCooldown: 0.85,
  fireRate: 9,
  rapidFireRate: 15,
  bulletSpeed: 1200,
  respawnDelay: 1.8,
  respawnShield: 2.5
};
export const POWER_TIME = 12;
export const POWERS = ['spread', 'rapid', 'pierce'];
const MAX_MULT = 150;
const MAX_STOCK = 6;
const SHARD_LIFE = 8;
const MAGNET = 170;

function createPlayer(arena) {
  return {
    x: arena.w / 2, y: arena.h / 2, vx: 0, vy: 0, r: PLAYER.r, angle: -Math.PI / 2,
    alive: true, invuln: 1.5, respawnT: 0, dashT: 0, dashCd: 0, dashX: 0, dashY: 0, fireCd: 0, kick: 0,
    power: { spread: 0, rapid: 0, pierce: 0 }
  };
}

// `portrait` stands the arena on its end, for tall phone screens.
export function createWorld({ seed = 1, lives = 3, bombs = 3, portrait = false } = {}) {
  const arena = portrait ? { w: ARENA.h, h: ARENA.w } : { ...ARENA };
  return {
    seed, rand: seededRandom(seed), arena, time: 0,
    wave: 0, score: 0, mult: 1, maxMult: 1, lives, bombs, kills: 0, deaths: 0,
    nextLifeAt: 200000, nextBombAt: 100000, lastPowerAt: -99, over: false,
    player: createPlayer(arena), bullets: [], shots: [], enemies: [], pickups: [], bomb: null, bombCount: 0,
    director: createDirector(), events: []
  };
}

// An empty input: no movement, no aim, nothing pressed.
export const idleInput = () => ({ moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: false, bomb: false });

const emit = (w, event) => { w.events.push(event); };

function addScore(w, points) {
  w.score += points;
  if (w.score >= w.nextLifeAt) {
    w.nextLifeAt *= 3;
    if (w.lives < MAX_STOCK) { w.lives += 1; emit(w, { type: 'extraLife' }); }
  }
  if (w.score >= w.nextBombAt) {
    w.nextBombAt = Math.round(w.nextBombAt * 2.5);
    if (w.bombs < MAX_STOCK) { w.bombs += 1; emit(w, { type: 'extraBomb' }); }
  }
}

export function spawnEnemy(w, type, x, y, options) {
  const e = makeEnemy(type, x, y, w.rand, options);
  w.enemies.push(e);
  emit(w, { type: 'spawn', enemy: type, x, y, boss: !!ENEMIES[type].boss });
  return e;
}

function spawnShot(w, x, y, angle, speed) {
  w.shots.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 7, life: 7 });
  emit(w, { type: 'enemyShot', x, y });
}

// What behaviours and the director may ask of the world.
const actionsFor = w => ({
  emit: event => emit(w, event),
  shoot: (x, y, angle, speed) => spawnShot(w, x, y, angle, speed),
  spawn: (type, x, y, options) => spawnEnemy(w, type, x, y, options)
});

function dropShards(w, x, y, count) {
  for (let i = 0; i < count; i++) {
    const a = w.rand() * TAU, speed = 80 + w.rand() * 160;
    w.pickups.push({ kind: 'shard', x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: SHARD_LIFE, spin: w.rand() * TAU });
  }
}

function dropPower(w, x, y) {
  const power = POWERS[Math.floor(w.rand() * POWERS.length)];
  w.pickups.push({ kind: 'power', power, x, y, vx: 0, vy: 0, life: 10, spin: 0 });
  w.lastPowerAt = w.time;
}

export function killEnemy(w, e, { byBomb = false, silent = false } = {}) {
  if (e.dead) return;
  e.dead = true;
  const def = ENEMIES[e.type];
  if (silent) { emit(w, { type: 'kill', enemy: e.type, x: e.x, y: e.y, r: e.r, points: 0, silent: true }); return; }
  const points = def.points * w.mult;
  addScore(w, points);
  w.kills += 1;
  emit(w, { type: 'kill', enemy: e.type, x: e.x, y: e.y, r: e.r, points, boss: !!def.boss, byBomb });
  if (!byBomb) dropShards(w, e.x, e.y, def.shards + (w.rand() < 0.3 ? 1 : 0));
  const powerOnField = w.pickups.some(p => p.kind === 'power');
  if (def.boss || (!byBomb && !powerOnField && w.time - w.lastPowerAt > 12 && w.rand() < 0.035)) dropPower(w, e.x, e.y);
  if (e.type === 'splitter') {
    for (let i = 0; i < 3; i++) {
      const a = e.spin + (i / 3) * TAU;
      const child = makeEnemy('splinter', e.x + Math.cos(a) * 10, e.y + Math.sin(a) * 10, w.rand, { pace: e.pace, spawnT: 0 });
      child.vx = Math.cos(a) * 320;
      child.vy = Math.sin(a) * 320;
      child.grace = 0.35; // can't touch the player for a moment, so point-blank kills aren't punished
      w.enemies.push(child);
    }
  }
}

function killPlayer(w) {
  const p = w.player;
  p.alive = false;
  p.respawnT = PLAYER.respawnDelay;
  p.power = { spread: 0, rapid: 0, pierce: 0 };
  w.lives -= 1;
  w.deaths += 1;
  w.mult = 1;
  emit(w, { type: 'playerDeath', x: p.x, y: p.y });
  // Everything but a boss is wiped, so the player comes back to a calm arena.
  for (const e of w.enemies) if (!ENEMIES[e.type].boss) killEnemy(w, e, { silent: true });
  w.shots.length = 0;
  w.pickups.length = 0;
  w.bullets.length = 0;
}

function firePattern(w, p) {
  const dx = Math.cos(p.angle), dy = Math.sin(p.angle);
  const shots = p.power.spread > 0
    ? [-0.2, -0.1, 0, 0.1, 0.2].map(spread => ({ angle: p.angle + spread, offset: 0 }))
    : [-6, 6].map(offset => ({ angle: p.angle, offset }));
  for (const { angle, offset } of shots) {
    const a = angle + (w.rand() - 0.5) * 0.04;
    w.bullets.push({
      x: p.x + dx * 18 - dy * offset, y: p.y + dy * 18 + dx * offset,
      vx: Math.cos(a) * PLAYER.bulletSpeed + p.vx * 0.2, vy: Math.sin(a) * PLAYER.bulletSpeed + p.vy * 0.2,
      pierce: p.power.pierce > 0 ? 2 : 0, hits: []
    });
  }
  p.kick = 1;
  emit(w, { type: 'shoot', x: p.x, y: p.y, angle: p.angle });
}

function updatePlayer(w, input, dt) {
  const p = w.player;
  if (!p.alive) {
    p.respawnT -= dt;
    if (p.respawnT > 0) return;
    if (w.lives <= 0) {
      if (!w.over) { w.over = true; emit(w, { type: 'gameOver', score: w.score }); }
      return;
    }
    Object.assign(p, { x: w.arena.w / 2, y: w.arena.h / 2, vx: 0, vy: 0, alive: true, invuln: PLAYER.respawnShield, dashT: 0, dashCd: 0 });
    emit(w, { type: 'respawn', x: p.x, y: p.y });
    return;
  }
  p.invuln = Math.max(0, p.invuln - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.kick = Math.max(0, p.kick - dt * 12);
  for (const power of POWERS) p.power[power] = Math.max(0, p.power[power] - dt);

  let mx = input.moveX, my = input.moveY;
  const moveLen = Math.hypot(mx, my);
  if (moveLen > 1) { mx /= moveLen; my /= moveLen; }
  const aimLen = Math.hypot(input.aimX, input.aimY);

  if (input.dash && p.dashCd <= 0) {
    const [dx, dy] = moveLen > 0.1 ? [mx, my] : aimLen > 0 ? [input.aimX / aimLen, input.aimY / aimLen] : [Math.cos(p.angle), Math.sin(p.angle)];
    const d = Math.hypot(dx, dy) || 1;
    p.dashX = dx / d; p.dashY = dy / d;
    p.dashT = PLAYER.dashTime;
    p.dashCd = PLAYER.dashCooldown;
    emit(w, { type: 'dash', x: p.x, y: p.y, dx: p.dashX, dy: p.dashY });
  }
  if (p.dashT > 0) {
    p.dashT -= dt;
    p.vx = p.dashX * PLAYER.dashSpeed;
    p.vy = p.dashY * PLAYER.dashSpeed;
    if (p.dashT <= 0) { p.vx *= 0.35; p.vy *= 0.35; }
  } else {
    p.vx = approach(p.vx, mx * PLAYER.speed, PLAYER.grip, dt);
    p.vy = approach(p.vy, my * PLAYER.speed, PLAYER.grip, dt);
  }
  p.x = clamp(p.x + p.vx * dt, p.r, w.arena.w - p.r);
  p.y = clamp(p.y + p.vy * dt, p.r, w.arena.h - p.r);

  if (aimLen > 0) p.angle = Math.atan2(input.aimY, input.aimX);
  else if (moveLen > 0.1) p.angle = Math.atan2(my, mx);

  p.fireCd -= dt;
  if (input.fire && aimLen > 0) {
    if (p.fireCd <= 0) {
      firePattern(w, p);
      p.fireCd += 1 / (p.power.rapid > 0 ? PLAYER.rapidFireRate : PLAYER.fireRate);
      if (p.fireCd < 0) p.fireCd = 0;
    }
  } else if (p.fireCd < 0) {
    p.fireCd = 0;
  }

  if (input.bomb && w.bombs > 0 && !w.bomb) {
    w.bombs -= 1;
    w.bombCount += 1;
    w.bomb = { x: p.x, y: p.y, r: 0, id: w.bombCount };
    p.invuln = Math.max(p.invuln, 0.8);
    emit(w, { type: 'bomb', x: p.x, y: p.y });
  }
}

function updateEnemies(w, dt, act) {
  const { arena } = w;
  for (const e of w.enemies) {
    e.flash = Math.max(0, e.flash - dt);
    if (e.spawnT > 0) {
      e.spawnT -= dt;
      continue;
    }
    e.t += dt;
    if (e.grace > 0) e.grace -= dt;
    BEHAVIOURS[e.type](e, w, dt, act);
    e.x += e.vx * dt;
    e.y += e.vy * dt;
    e.hitWall = false;
    const bouncy = e.type === 'mote' || e.type === 'splinter' || e.type === 'charger';
    if (e.x < e.r || e.x > arena.w - e.r) {
      e.x = clamp(e.x, e.r, arena.w - e.r);
      e.vx = bouncy ? -e.vx : 0;
      e.hitWall = true;
    }
    if (e.y < e.r || e.y > arena.h - e.r) {
      e.y = clamp(e.y, e.r, arena.h - e.r);
      e.vy = bouncy ? -e.vy : 0;
      e.hitWall = true;
    }
    if (e.hitWall && e.type === 'mote') e.heading = Math.atan2(e.vy, e.vx);
  }
  // Keep enemies from stacking into one blob.
  const active = w.enemies.filter(e => e.spawnT <= 0 && !ENEMIES[e.type].boss);
  for (let i = 0; i < active.length; i++) {
    const a = active[i];
    for (let j = i + 1; j < active.length; j++) {
      const b = active[j];
      const dx = b.x - a.x, dy = b.y - a.y, min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2), push = (min - d) / 2;
      const nx = dx / d, ny = dy / d;
      a.x -= nx * push; a.y -= ny * push;
      b.x += nx * push; b.y += ny * push;
    }
  }
}

function damageEnemy(w, e, amount, fromX, fromY) {
  e.hp -= amount;
  e.flash = 0.08;
  const def = ENEMIES[e.type];
  if (!def.boss) {
    const d = Math.hypot(fromX, fromY) || 1;
    e.vx += (fromX / d) * 90;
    e.vy += (fromY / d) * 90;
  }
  if (e.hp <= 0) killEnemy(w, e);
  else emit(w, { type: 'hit', enemy: e.type, x: e.x, y: e.y, boss: !!def.boss });
}

function updateBullets(w, dt) {
  const { arena } = w;
  for (const b of w.bullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (b.x < 0 || b.x > arena.w || b.y < 0 || b.y > arena.h) {
      b.dead = true;
      emit(w, { type: 'wallHit', x: clamp(b.x, 0, arena.w), y: clamp(b.y, 0, arena.h) });
      continue;
    }
    for (const e of w.enemies) {
      if (e.dead || e.spawnT > 0 || b.hits.includes(e)) continue;
      const dx = e.x - b.x, dy = e.y - b.y, reach = e.r + 4;
      if (dx * dx + dy * dy > reach * reach) continue;
      b.hits.push(e);
      damageEnemy(w, e, 1, b.vx, b.vy);
      if (b.pierce-- <= 0) { b.dead = true; break; }
    }
    if (b.dead) continue;
    for (const s of w.shots) {
      if (s.dead) continue;
      const dx = s.x - b.x, dy = s.y - b.y, reach = s.r + 4;
      if (dx * dx + dy * dy > reach * reach) continue;
      s.dead = true;
      emit(w, { type: 'shotPop', x: s.x, y: s.y });
      if (b.pierce-- <= 0) { b.dead = true; break; }
    }
  }
}

function updateShots(w, dt) {
  const { arena, player: p } = w;
  for (const s of w.shots) {
    if (s.dead) continue;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.life -= dt;
    if (s.life <= 0 || s.x < -20 || s.x > arena.w + 20 || s.y < -20 || s.y > arena.h + 20) s.dead = true;
  }
}

const vulnerable = p => p.alive && p.invuln <= 0 && p.dashT <= 0;

function checkPlayerHits(w) {
  const p = w.player;
  if (!vulnerable(p)) return;
  for (const e of w.enemies) {
    if (e.dead || e.spawnT > 0 || e.grace > 0) continue;
    const reach = e.r * 0.85 + p.r;
    if ((e.x - p.x) ** 2 + (e.y - p.y) ** 2 < reach * reach) { killPlayer(w); return; }
  }
  for (const s of w.shots) {
    if (s.dead) continue;
    const reach = s.r * 0.8 + p.r;
    if ((s.x - p.x) ** 2 + (s.y - p.y) ** 2 < reach * reach) { killPlayer(w); return; }
  }
}

function updatePickups(w, dt) {
  const p = w.player;
  for (const k of w.pickups) {
    k.life -= dt;
    k.spin += dt * 4;
    if (k.life <= 0) { k.dead = true; continue; }
    const dx = p.x - k.x, dy = p.y - k.y, d = Math.hypot(dx, dy) || 1;
    let caught = d <= p.r + 18;
    if (p.alive && d < MAGNET && k.kind === 'shard') {
      // Magnetized shards fly straight at the ship, speeding up, so they never slingshot past it.
      k.magnet = Math.min(1200, (k.magnet ?? Math.hypot(k.vx, k.vy)) + 3000 * dt);
      k.vx = (dx / d) * k.magnet;
      k.vy = (dy / d) * k.magnet;
      if (k.magnet * dt >= d) caught = true;
    } else {
      k.magnet = undefined;
      const drag = Math.exp(-3 * dt);
      k.vx *= drag; k.vy *= drag;
    }
    k.x = clamp(k.x + k.vx * dt, 8, w.arena.w - 8);
    k.y = clamp(k.y + k.vy * dt, 8, w.arena.h - 8);
    if (!p.alive || !caught) continue;
    k.dead = true;
    if (k.kind === 'shard') {
      w.mult = Math.min(MAX_MULT, w.mult + 1);
      w.maxMult = Math.max(w.maxMult, w.mult);
      emit(w, { type: 'shard', x: k.x, y: k.y, mult: w.mult });
    } else {
      p.power[k.power] = POWER_TIME;
      emit(w, { type: 'power', x: k.x, y: k.y, power: k.power });
    }
  }
}

function updateBomb(w, dt) {
  const bomb = w.bomb;
  if (!bomb) return;
  bomb.r += 2200 * dt;
  const r2 = bomb.r * bomb.r;
  for (const e of w.enemies) {
    if (e.dead || (e.x - bomb.x) ** 2 + (e.y - bomb.y) ** 2 > r2) continue;
    if (ENEMIES[e.type].boss) {
      if (e.bombHit !== bomb.id && e.spawnT <= 0) { e.bombHit = bomb.id; damageEnemy(w, e, 30, e.x - bomb.x, e.y - bomb.y); }
    } else {
      killEnemy(w, e, { byBomb: true, silent: e.spawnT > 0 });
    }
  }
  for (const s of w.shots) if ((s.x - bomb.x) ** 2 + (s.y - bomb.y) ** 2 < r2) s.dead = true;
  if (bomb.r > 2000) w.bomb = null;
}

const sweep = list => {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (!list[i].dead) list[j++] = list[i];
  list.length = j;
};

// Advances the world by dt seconds (callers keep dt at 1/60 s or less). `input.dash` and `input.bomb` are
// presses: pass them for one step only.
export function step(w, input, dt) {
  if (w.over) return;
  w.time += dt;
  const act = actionsFor(w);
  updatePlayer(w, input, dt);
  updateDirector(w, dt, act);
  updateEnemies(w, dt, act);
  updateBullets(w, dt);
  updateShots(w, dt);
  updateBomb(w, dt);
  checkPlayerHits(w);
  updatePickups(w, dt);
  sweep(w.enemies);
  sweep(w.bullets);
  sweep(w.shots);
  sweep(w.pickups);
}
