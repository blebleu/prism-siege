// Visual effects that don't affect play: sparks, shockwave rings, floating text, screen shake, hit-stop and
// screen flashes. They use Math.random rather than the world's seeded generator, so the effects never change
// how a game plays out.
const MAX_PARTS = 2500;

export function createFx() {
  return { parts: [], rings: [], texts: [], trauma: 0, hitstop: 0, flash: 0, flashColor: '#fff', t: 0 };
}

// A burst of sparks flying out from (x, y). spread < TAU with `angle` makes a cone.
export function sparks(fx, x, y, color, count, speed, life, { angle = 0, spread = Math.PI * 2, size = 2, drag = 3, line = true } = {}) {
  for (let i = 0; i < count; i++) {
    if (fx.parts.length >= MAX_PARTS) return;
    const a = angle + (Math.random() - 0.5) * spread;
    const v = speed * (0.25 + Math.random() * 0.75);
    const l = life * (0.5 + Math.random() * 0.5);
    fx.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: l, max: l, color, size, drag, line });
  }
}

export function ring(fx, x, y, color, radius, life, width = 3) {
  fx.rings.push({ x, y, color, radius, life, max: life, width });
}

export function floatText(fx, x, y, text, color, size = 18) {
  fx.texts.push({ x, y, text, color, size, life: 1.1, max: 1.1 });
}

export const addShake = (fx, amount) => { fx.trauma = Math.min(1, fx.trauma + amount); };
export const hitstop = (fx, seconds) => { fx.hitstop = Math.max(fx.hitstop, seconds); };
export function flash(fx, color, amount) {
  fx.flash = Math.max(fx.flash, amount);
  fx.flashColor = color;
}

export function updateFx(fx, dt) {
  dt = Math.max(0, dt);
  fx.t += dt;
  fx.trauma = Math.max(0, fx.trauma - dt * 1.4);
  fx.flash = Math.max(0, fx.flash - dt * 2.5);
  for (const p of fx.parts) {
    p.life -= dt;
    const drag = Math.exp(-p.drag * dt);
    p.vx *= drag;
    p.vy *= drag;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  for (const r of fx.rings) r.life -= dt;
  for (const t of fx.texts) { t.life -= dt; t.y -= 40 * dt; }
  fx.parts = fx.parts.filter(p => p.life > 0);
  fx.rings = fx.rings.filter(r => r.life > 0);
  fx.texts = fx.texts.filter(t => t.life > 0);
}

// Camera offset for the current shake: trauma squared, so small hits barely move and big ones really kick.
export function shakeOffset(fx, scale) {
  const s = fx.trauma * fx.trauma * scale;
  if (s <= 0) return [0, 0];
  const t = fx.t * 38;
  return [Math.sin(t * 1.1) * 18 * s + (Math.random() - 0.5) * 6 * s, Math.cos(t * 0.9) * 18 * s + (Math.random() - 0.5) * 6 * s];
}

// How far along an effect is, from 1 (just made) to 0 (gone), kept in range so sizes never go negative (the
// canvas throws on a negative radius).
const remaining = e => Math.min(1, Math.max(0, e.life / e.max));

// Drawn in world space with additive blending already on.
export function drawFx(ctx, fx) {
  for (const p of fx.parts) {
    const k = remaining(p);
    ctx.globalAlpha = Math.min(1, k * 1.5);
    ctx.strokeStyle = ctx.fillStyle = p.color;
    if (p.line) {
      ctx.lineWidth = p.size;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.4 + k * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  for (const r of fx.rings) {
    const k = remaining(r);
    ctx.globalAlpha = k;
    ctx.strokeStyle = r.color;
    ctx.lineWidth = r.width * k + 0.5;
    ctx.beginPath();
    ctx.arc(r.x, r.y, r.radius * (1 - k * k), 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const t of fx.texts) {
    ctx.globalAlpha = Math.min(1, remaining(t) * 2);
    ctx.fillStyle = t.color;
    ctx.font = `700 ${t.size}px "Segoe UI", system-ui, sans-serif`;
    ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
}
