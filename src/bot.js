// A simple autopilot that plays behind the title screen (and in tests): steer away from nearby danger and the
// walls, drift toward shards, shoot the nearest enemy, and dash or bomb when cornered.
export function botInput(w) {
  const p = w.player;
  const input = { moveX: 0, moveY: 0, aimX: 0, aimY: 0, fire: false, dash: false, bomb: false };
  if (!p.alive) return input;
  let mx = 0, my = 0, nearest = null, nearestD = Infinity, close = 0;
  for (const e of w.enemies) {
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
    if (e.spawnT <= 0 && d < nearestD) { nearest = e; nearestD = d; }
    const reach = 260 + e.r * 3;
    if (d < reach) {
      const weight = ((reach - d) / reach) ** 2 * 3;
      mx += (dx / d) * weight;
      my += (dy / d) * weight;
    }
    if (d < 90 + e.r) close += 1;
  }
  for (const s of w.shots) {
    const dx = p.x - s.x, dy = p.y - s.y, d = Math.hypot(dx, dy) || 1;
    if (d < 180) { mx += (dx / d) * 4 * (1 - d / 180); my += (dy / d) * 4 * (1 - d / 180); }
  }
  // Walls push back, the middle pulls gently, and shards within reach pull a little.
  const edge = 160;
  if (p.x < edge) mx += (edge - p.x) / edge * 2;
  if (p.x > w.arena.w - edge) mx -= (p.x - (w.arena.w - edge)) / edge * 2;
  if (p.y < edge) my += (edge - p.y) / edge * 2;
  if (p.y > w.arena.h - edge) my -= (p.y - (w.arena.h - edge)) / edge * 2;
  mx += (w.arena.w / 2 - p.x) / w.arena.w * 0.4;
  my += (w.arena.h / 2 - p.y) / w.arena.h * 0.4;
  const shard = w.pickups.find(k => Math.hypot(k.x - p.x, k.y - p.y) < 320);
  if (shard) { mx += (shard.x - p.x) / 320 * 0.6; my += (shard.y - p.y) / 320 * 0.6; }
  const len = Math.hypot(mx, my);
  if (len > 0.05) { input.moveX = mx / Math.max(1, len); input.moveY = my / Math.max(1, len); }
  if (nearest) {
    // Lead the target a little.
    const lead = nearestD / 1200;
    input.aimX = nearest.x + nearest.vx * lead - p.x;
    input.aimY = nearest.y + nearest.vy * lead - p.y;
    const aim = Math.hypot(input.aimX, input.aimY) || 1;
    input.aimX /= aim;
    input.aimY /= aim;
    input.fire = true;
  }
  input.dash = nearestD < 50 + (nearest?.r ?? 0);
  input.bomb = close >= 6;
  return input;
}

// The autopilot's pick at a level-up: the first of the offered upgrades in this order of preference.
const PREFERENCE = ['multishot', 'rapid', 'heavy', 'orbitals', 'shield', 'pierce', 'homing', 'thrusters', 'magnet', 'ricochet', 'tailgun', 'phase', 'ram', 'salvage'];
export function botChoice(w) {
  const rank = id => { const i = PREFERENCE.indexOf(id); return i < 0 ? PREFERENCE.length : i; };
  return w.choice.reduce((best, id, i) => rank(id) < rank(w.choice[best]) ? i : best, 0);
}
