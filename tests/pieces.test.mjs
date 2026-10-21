import test from 'node:test';
import assert from 'node:assert/strict';
import { key, normalize, rotate, dims, orientations, lieFlat } from '../src/core/pieces.js';

test('key joins coordinates', () => assert.equal(key([1, 2, 3]), '1,2,3'));

test('normalize shifts to min 0 and sorts canonically', () => {
  assert.deepEqual(normalize([[3, 5, 2], [2, 5, 2], [2, 6, 2]]), [[0, 0, 0], [0, 1, 0], [1, 0, 0]]);
});

test('rotate y four times returns original', () => {
  let c = [[0, 0, 0], [1, 0, 0], [1, 1, 0]];
  for (let i = 0; i < 4; i++) c = rotate(c, 'y');
  assert.deepEqual(normalize(c), normalize([[0, 0, 0], [1, 0, 0], [1, 1, 0]]));
});

test('rotate x and z four times return original', () => {
  const base = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]];
  for (const axis of ['x', 'z']) {
    let c = base;
    for (let i = 0; i < 4; i++) c = rotate(c, axis);
    assert.deepEqual(c, normalize(base));
  }
});

test('rotate y maps [x,y,z] to [z,y,-x]', () => {
  assert.deepEqual(rotate([[0, 0, 0], [1, 0, 0]], 'y'), [[0, 0, 0], [0, 0, 1]]);
});

test('rotate x maps [x,y,z] to [x,-z,y]', () => {
  assert.deepEqual(rotate([[0, 0, 0], [0, 1, 0]], 'x'), [[0, 0, 0], [0, 0, 1]]);
});

test('rotate z maps [x,y,z] to [-y,x,z]', () => {
  assert.deepEqual(rotate([[0, 0, 0], [1, 0, 0]], 'z'), [[0, 0, 0], [0, 1, 0]]);
});

test('dims returns bounding box size', () => {
  assert.deepEqual(dims([[0, 0, 0], [2, 0, 0], [2, 1, 0]]), [3, 2, 1]);
});

test('I-tetracube has 3 orientations', () =>
  assert.equal(orientations([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]]).length, 3));

test('L-tricube corner has 12 orientations', () =>
  assert.equal(orientations([[0, 0, 0], [1, 0, 0], [0, 1, 0]]).length, 12));

test('orientations are canonical and unique', () => {
  const os = orientations([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  const set = new Set(os.map((o) => JSON.stringify(o)));
  assert.equal(set.size, os.length);
  for (const o of os) assert.deepEqual(o, normalize(o));
});

test('lieFlat makes I-bar height 1 and long along x', () =>
  assert.deepEqual(dims(lieFlat([[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]], 'x')), [4, 1, 1]));

test('lieFlat long along z', () =>
  assert.deepEqual(dims(lieFlat([[0, 0, 0], [1, 0, 0], [2, 0, 0]], 'z')), [1, 1, 3]));

test('chiral screw tetracube has 12 orientations, mirror image shares none', () => {
  // 나사 사면체는 180도 대칭이 있어 24가 아니라 12방향이며, 거울상 12방향과 겹치지 않는다(합 24).
  const a = orientations([[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, 1]]);
  const m = orientations([[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 1, -1]]);
  assert.equal(a.length, 12);
  assert.equal(m.length, 12);
  const set = new Set(a.map((o) => JSON.stringify(o)));
  assert.equal(m.filter((o) => set.has(JSON.stringify(o))).length, 0);
});
