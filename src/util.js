// Small math helpers shared by the simulation and the renderer.
export const TAU = Math.PI * 2;
export const clamp = (value, low, high) => value < low ? low : value > high ? high : value;
export const lerp = (a, b, t) => a + (b - a) * t;

// Frame-rate independent easing of `current` toward `target`: `rate` is how quickly the gap closes per second.
export const approach = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));

// The shortest signed turn from angle a to angle b, in -PI..PI.
export function angleDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

// A seeded random source (mulberry32), so a whole game can be replayed from its seed in tests.
export function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
