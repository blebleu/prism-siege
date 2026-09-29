import test from 'node:test';
import assert from 'node:assert/strict';
import { createFx, drawFx, floatText, ring, sparks, updateFx } from '../src/fx.js';

// Just enough of a canvas context to draw effects, and like the real one it rejects a negative arc radius.
function fakeContext() {
  const noop = () => {};
  return {
    beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, fill: noop, fillText: noop,
    arc(x, y, radius) { if (!(radius >= 0)) throw new RangeError(`negative radius ${radius}`); }
  };
}

test('effects never draw with a negative size, even if time briefly runs backwards', () => {
  const fx = createFx();
  ring(fx, 0, 0, '#fff', 110, 0.5, 4);
  sparks(fx, 0, 0, '#fff', 20, 300, 0.5, { line: false });
  floatText(fx, 0, 0, 'MULTISHOT', '#fff');
  // A frame whose timestamp came before the last click gave a negative step; that used to push effects past
  // their starting size and throw, which stopped the game.
  updateFx(fx, -0.002);
  assert.doesNotThrow(() => drawFx(fakeContext(), fx));
  fx.rings[0].life = fx.rings[0].max * 1.01;
  fx.parts[0].life = -0.01;
  assert.doesNotThrow(() => drawFx(fakeContext(), fx));
  updateFx(fx, 0.25);
  assert.doesNotThrow(() => drawFx(fakeContext(), fx));
});
