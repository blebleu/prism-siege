import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSave, PREFIX, removeSave, writeSave } from '../src/save.js';

// A stand-in for the browser's localStorage.
function fakeStorage() {
  const items = new Map();
  return {
    items,
    getItem: key => items.has(key) ? items.get(key) : null,
    setItem: (key, value) => { items.set(key, String(value)); },
    removeItem: key => { items.delete(key); }
  };
}

test.beforeEach(() => { globalThis.localStorage = fakeStorage(); });
test.after(() => { delete globalThis.localStorage; });

test('saves round-trip under the game prefix', () => {
  assert.equal(PREFIX, 'tp:prism-siege:');
  assert.equal(writeSave('scores', 1, { best: 1200 }), true);
  assert.ok(localStorage.items.has(`${PREFIX}scores`));
  assert.deepEqual(loadSave('scores', 1), { best: 1200 });
  removeSave('scores');
  assert.equal(loadSave('scores', 1), null);
});

test('older saves are upgraded, newer or broken ones ignored', () => {
  writeSave('scores', 1, { best: 2 });
  assert.deepEqual(loadSave('scores', 2, (data, from) => ({ ...data, upgradedFrom: from })), { best: 2, upgradedFrom: 1 });
  assert.equal(loadSave('scores', 2), null);
  writeSave('scores', 3, { best: 9 });
  assert.equal(loadSave('scores', 2), null);
  localStorage.setItem(`${PREFIX}scores`, '{not json');
  assert.equal(loadSave('scores', 1), null);
});

test('blocked or full storage never throws', () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(writeSave('scores', 1, {}), false);
  assert.equal(loadSave('scores', 1), null);
  assert.doesNotThrow(() => removeSave('scores'));
  delete globalThis.localStorage;
  assert.equal(writeSave('scores', 1, {}), false);
});
