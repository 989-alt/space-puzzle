import test from 'node:test';
import assert from 'node:assert/strict';
import { load, save } from '../src/core/storage.js';

function withStorage(mock, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { value: mock, configurable: true, writable: true });
  try { fn(); } finally {
    if (had) Object.defineProperty(globalThis, 'localStorage', had);
    else delete globalThis.localStorage;
  }
}

test('storageThrowingStillWorks', () => {
  withStorage({ getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } }, () => {
    assert.equal(load('best', 0), 0);
    assert.doesNotThrow(() => save('best', 5));
  });
});
test('missing localStorage returns fallback', () => {
  withStorage(undefined, () => {
    assert.equal(load('best', 7), 7);
    assert.doesNotThrow(() => save('best', 1));
  });
});
test('round trip with ck. prefix', () => {
  const m = new Map();
  withStorage({ getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) }, () => {
    save('best', { a: 1 });
    assert.ok(m.has('ck.best'));
    assert.deepEqual(load('best', null), { a: 1 });
    assert.equal(load('nope', 'fb'), 'fb');
  });
});
test('unparseable value returns fallback', () => {
  withStorage({ getItem: () => '{bad', setItem() {} }, () => {
    assert.equal(load('best', 3), 3);
  });
});
