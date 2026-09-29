// Draws the world onto the canvas: camera, warping grid, neon shapes (drawn additively so overlaps glow), a
// cheap bloom pass, screen flash, and markers for enemies outside the view.
import { ENEMIES } from './enemies.js';
import { drawGrid } from './grid.js';
import { drawFx, shakeOffset } from './fx.js';
import { ORBITAL, orbitalPositions } from './sim.js';
import { approach, clamp, TAU } from './util.js';

const BACKGROUND = '#04050d';
const FLOOR = '#070a1c';
const BORDER = '#7a86ff';
const GRID = 'rgba(70, 90, 255, 0.2)';
const GRID_MAJOR = 'rgba(90, 120, 255, 0.34)';
const PLAYER_COLOR = '#eaf6ff';
const PLAYER_GLOW = '#7df9ff';
const BULLET = '#fff2b8';
const SHOT = '#ff6a3d';
const SHARD = '#ffd166';
const SHIELD = '#5cf2b0';
// About this much of the arena is visible, whatever the screen size (the ratio adapts to the screen's shape).
const VIEW_AREA = 1150 * 760;

// Strokes the current path twice: a wide faint pass for the glow, then the sharp line.
function glow(ctx, color, width, alpha = 1) {
  ctx.strokeStyle = color;
  ctx.globalAlpha = alpha * 0.28;
  ctx.lineWidth = width * 3.4;
  ctx.stroke();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.stroke();
}

function poly(ctx, points) {
  ctx.beginPath();
  points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
  ctx.closePath();
}

// Adds a regular polygon to the current path (callers begin the path).
function ngon(ctx, sides, r, rotation = 0) {
  for (let i = 0; i < sides; i++) {
    const a = rotation + (i / sides) * TAU;
    i ? ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r) : ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

// Each enemy's outline, drawn around (0, 0).
const SHAPES = {
  mote(ctx, e, r) {
    ctx.rotate(e.spin);
    ctx.beginPath();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * TAU;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a + 0.9) * r * 0.55, Math.sin(a + 0.9) * r * 0.55);
      ctx.closePath();
    }
  },
  seeker(ctx, e, r) {
    ctx.rotate(e.angle);
    const pulse = 1 + Math.sin(e.t * 9) * 0.08;
    poly(ctx, [[r * 1.2 * pulse, 0], [0, r * 0.75], [-r * 1.1 * pulse, 0], [0, -r * 0.75]]);
  },
  dodger(ctx, e, r) {
    ctx.rotate(e.spin * 0.4);
    ctx.beginPath();
    ctx.rect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
    ngon(ctx, 4, r * 0.62, e.spin);
  },
  splitter(ctx, e, r) {
    ctx.rotate(e.spin);
    ctx.beginPath();
    ctx.rect(-r * 0.85, -r * 0.85, r * 1.7, r * 1.7);
    ctx.moveTo(-r * 0.85, -r * 0.85); ctx.lineTo(r * 0.85, r * 0.85);
    ctx.moveTo(r * 0.85, -r * 0.85); ctx.lineTo(-r * 0.85, r * 0.85);
  },
  splinter(ctx, e, r) {
    ctx.rotate(e.spin);
    ctx.beginPath();
    ctx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
  },
  charger(ctx, e, r) {
    ctx.rotate(e.angle);
    poly(ctx, [[r * 1.35, 0], [-r, r * 0.95], [-r * 0.35, 0], [-r, -r * 0.95]]);
  },
  spitter(ctx, e, r) {
    ctx.beginPath();
    ngon(ctx, 6, r, e.spin);
    const charge = clamp(1 - e.fireT / 0.6, 0, 1);
    ctx.moveTo(r * (0.25 + charge * 0.3), 0);
    ctx.arc(0, 0, r * (0.25 + charge * 0.3), 0, TAU);
  },
  warden(ctx, e, r) {
    ctx.beginPath();
    ngon(ctx, 6, r, e.spin);
    ngon(ctx, 6, r * 0.62, -e.spin * 1.6);
  }
};

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  const bloom = document.createElement('canvas');
  const bctx = bloom.getContext('2d');
  const view = { cssW: 1, cssH: 1, dpr: 1, scale: 1, camX: 0, camY: 0, viewW: 1, viewH: 1, placed: false };
  const bloomWorks = supportsCanvasFilter();

  function resize() {
    // At least one pixel: a hidden or collapsed page can report zero, and a zero-size canvas can't be drawn.
    view.cssW = Math.max(1, canvas.clientWidth || window.innerWidth);
    view.cssH = Math.max(1, canvas.clientHeight || window.innerHeight);
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(view.cssW * view.dpr);
    canvas.height = Math.round(view.cssH * view.dpr);
    view.scale = clamp(Math.sqrt((view.cssW * view.cssH) / VIEW_AREA), 0.42, 2.4);
    view.viewW = view.cssW / view.scale;
    view.viewH = view.cssH / view.scale;
    bloom.width = Math.max(1, Math.round(canvas.width / 4));
    bloom.height = Math.max(1, Math.round(canvas.height / 4));
  }

  // Follow the player (leaning a little toward where they aim), but never show much past the arena's edge;
  // if the view is bigger than the arena along an axis, centre on it.
  function moveCamera(w, dt, lead) {
    const pad = 80, p = w.player; // room past the edges, so the HUD never hides the walls
    const axis = (size, view, center) => view >= size + pad * 2 ? size / 2 : clamp(center, view / 2 - pad, size - view / 2 + pad);
    const tx = axis(w.arena.w, view.viewW, p.x + lead[0]);
    const ty = axis(w.arena.h, view.viewH, p.y + lead[1]);
    if (!view.placed) { view.camX = tx; view.camY = ty; view.placed = true; return; }
    view.camX = approach(view.camX, tx, 6, dt);
    view.camY = approach(view.camY, ty, 6, dt);
  }

  const screenToWorld = (sx, sy) => [view.camX + (sx - view.cssW / 2) / view.scale, view.camY + (sy - view.cssH / 2) / view.scale];

  function draw(w, fx, grid, { dt = 0, glowOn = true, shake = 1, flashes = 1, lead = [0, 0], crosshair = null, trail = [] } = {}) {
    moveCamera(w, dt, lead);
    const { dpr, scale, cssW, cssH } = view;
    const [sx, sy] = shakeOffset(fx, shake);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const k = dpr * scale;
    ctx.setTransform(k, 0, 0, k, dpr * (cssW / 2) - (view.camX + sx) * k, dpr * (cssH / 2) - (view.camY + sy) * k);

    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, w.arena.w, w.arena.h);
    ctx.globalCompositeOperation = 'lighter';
    drawGrid(ctx, grid, GRID, GRID_MAJOR);
    ctx.beginPath();
    ctx.rect(0, 0, w.arena.w, w.arena.h);
    glow(ctx, BORDER, 4);

    drawPickups(ctx, w);
    for (const e of w.enemies) drawEnemy(ctx, e, w);
    drawShots(ctx, w);
    drawBullets(ctx, w);
    drawPlayer(ctx, w, trail);
    if (w.bomb) {
      ctx.beginPath();
      ctx.arc(w.bomb.x, w.bomb.y, w.bomb.r, 0, TAU);
      glow(ctx, '#ffffff', 6, clamp(1 - w.bomb.r / 2000, 0, 1));
    }
    drawFx(ctx, fx);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    if (crosshair && w.player.alive) drawCrosshair(ctx, crosshair, scale);

    if (glowOn && bloomWorks) {
      // Bloom: a quarter-size copy of the frame, with everything but the bright shapes pushed to black by the
      // contrast, blurred and added back on top.
      bctx.globalCompositeOperation = 'copy';
      bctx.filter = 'contrast(3) blur(5px)';
      bctx.drawImage(canvas, 0, 0, bloom.width, bloom.height);
      bctx.filter = 'none';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.9;
      ctx.drawImage(bloom, 0, 0, canvas.width, canvas.height);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    drawOffscreenMarkers(ctx, w);
    if (fx.flash > 0 && flashes > 0) {
      ctx.globalAlpha = fx.flash * 0.35 * flashes;
      ctx.fillStyle = fx.flashColor;
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.globalAlpha = 1;
    }
  }

  function drawOffscreenMarkers(ctx, w) {
    const inset = 14;
    let shown = 0;
    for (const e of w.enemies) {
      const x = (e.x - view.camX) * view.scale + view.cssW / 2;
      const y = (e.y - view.camY) * view.scale + view.cssH / 2;
      if (x >= 0 && x <= view.cssW && y >= 0 && y <= view.cssH) continue;
      if (++shown > 40) break;
      const mx = clamp(x, inset, view.cssW - inset), my = clamp(y, inset, view.cssH - inset);
      const a = Math.atan2(y - view.cssH / 2, x - view.cssW / 2);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(a);
      ctx.globalAlpha = e.spawnT > 0 ? 0.45 : 0.85;
      ctx.fillStyle = ENEMIES[e.type].color;
      poly(ctx, [[7, 0], [-5, 5], [-5, -5]]);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  return { canvas, view, resize, draw, screenToWorld, bloomWorks };
}

function drawEnemy(ctx, e, w) {
  const def = ENEMIES[e.type];
  const shape = SHAPES[e.type];
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.spawnT > 0) {
    // Spawning: a faint outline shrinking into place, plus a closing ring. It can't hurt yet.
    const k = e.spawnT / (def.boss ? 1.8 : 0.8);
    ctx.save();
    ctx.scale(1 + k * 1.3, 1 + k * 1.3);
    shape(ctx, e, e.r);
    glow(ctx, def.color, 1.5, 0.25 + 0.2 * Math.sin(w.time * 30));
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, 0, e.r + k * 50, 0, TAU);
    glow(ctx, def.color, 1.2, 0.5 * (1 - k));
    ctx.restore();
    return;
  }
  if (e.type === 'charger' && e.state === 'aim') {
    // Telegraph: the line it's about to charge along.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(e.angle) * 700, Math.sin(e.angle) * 700);
    glow(ctx, def.color, 1, 0.18 + 0.12 * Math.sin(e.t * 40));
  }
  const color = e.flash > 0 || (e.type === 'charger' && e.state === 'aim' && Math.sin(e.t * 40) > 0) ? '#ffffff' : def.color;
  const alpha = e.grace > 0 ? 0.55 : 1;
  ctx.save();
  shape(ctx, e, e.r);
  glow(ctx, color, def.boss ? 4 : 2.2, alpha);
  ctx.restore();
  if (def.boss) {
    const pulse = 0.3 + Math.sin(e.t * 6) * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, e.r * pulse, 0, TAU);
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.8;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, e.r + 14, -Math.PI / 2, -Math.PI / 2 + TAU * (e.hp / e.maxHp));
    glow(ctx, '#ffffff', 2, 0.6);
  }
  ctx.restore();
}

function drawBullets(ctx, w) {
  ctx.beginPath();
  for (const b of w.bullets) {
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(b.x - b.vx * 0.022, b.y - b.vy * 0.022);
  }
  ctx.lineCap = 'round';
  glow(ctx, BULLET, 2 + w.stats.damage); // Heavy Rounds make thicker bullets
  ctx.lineCap = 'butt';
}

function drawShots(ctx, w) {
  for (const s of w.shots) {
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = SHOT;
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 2, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffd6b0';
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r * 0.65, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.r, 0, TAU);
    glow(ctx, SHOT, 2);
  }
  ctx.globalAlpha = 1;
}

function drawPickups(ctx, w) {
  for (const k of w.pickups) {
    const blinking = k.life < 1.5 && Math.floor(k.life * 10) % 2 === 0;
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.rotate(k.spin);
    poly(ctx, [[0, -7], [5, 0], [0, 7], [-5, 0]]);
    glow(ctx, SHARD, 1.6, blinking ? 0.25 : 1);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawShip(ctx) {
  poly(ctx, [[17, 0], [-10, 12], [-4, 0], [-10, -12]]);
}

function drawPlayer(ctx, w, trail) {
  const p = w.player;
  for (const ghost of trail) {
    ctx.save();
    ctx.translate(ghost.x, ghost.y);
    ctx.rotate(ghost.angle);
    drawShip(ctx);
    glow(ctx, PLAYER_GLOW, 1.5, ghost.alpha * 0.5);
    ctx.restore();
  }
  if (!p.alive) return;
  const blink = p.invuln > 0 && Math.floor(w.time * 16) % 2 === 0;
  ctx.save();
  ctx.translate(p.x - Math.cos(p.angle) * p.kick * 3, p.y - Math.sin(p.angle) * p.kick * 3);
  ctx.rotate(p.angle);
  drawShip(ctx);
  glow(ctx, PLAYER_GLOW, 2.5, blink ? 0.35 : 0.9);
  drawShip(ctx);
  ctx.strokeStyle = PLAYER_COLOR;
  ctx.globalAlpha = blink ? 0.4 : 1;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
  if (p.invuln > 0) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 26, 0, TAU);
    glow(ctx, PLAYER_GLOW, 1.2, Math.min(1, p.invuln) * 0.45);
  }
  if (p.shield) {
    // Deflector: a slowly turning hexagon around the ship while the shield is up.
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.beginPath();
    ngon(ctx, 6, 24, w.time * 0.8);
    glow(ctx, SHIELD, 1.6, 0.55 + Math.sin(w.time * 4) * 0.15);
    ctx.restore();
  }
  for (const [x, y] of orbitalPositions(w)) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(w.time * 6);
    poly(ctx, [[0, -ORBITAL.r], [ORBITAL.r * 0.75, 0], [0, ORBITAL.r], [-ORBITAL.r * 0.75, 0]]);
    glow(ctx, PLAYER_GLOW, 2.2);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function drawCrosshair(ctx, [x, y], scale) {
  const s = 1 / Math.max(0.6, scale);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, 9, 0, TAU);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    ctx.moveTo(dx * 13, dy * 13);
    ctx.lineTo(dx * 19, dy * 19);
  }
  ctx.stroke();
  ctx.restore();
}

// Some browsers accept ctx.filter but ignore it; check that a blur really spreads a pixel before using bloom.
function supportsCanvasFilter() {
  try {
    const test = document.createElement('canvas');
    test.width = test.height = 9;
    const c = test.getContext('2d', { willReadFrequently: true });
    if (!('filter' in c)) return false;
    c.filter = 'blur(2px)';
    c.fillStyle = '#fff';
    c.fillRect(4, 4, 1, 1);
    return c.getImageData(1, 4, 1, 1).data[3] > 0;
  } catch {
    return false;
  }
}
