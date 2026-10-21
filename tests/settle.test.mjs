// settleAll: 받침이 빠진 조각을 아래로 떨어뜨리는 중력 처리(끌기·돌리기·놓기 뒤).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleAll, occupiedSet } from '../src/core/board.js';

const bar2 = [[0, 0, 0], [1, 0, 0]];
const one = [[0, 0, 0]];
const P = (cells, x, y, z, extra = {}) => ({ cells, pos: [x, y, z], ...extra });

test('move the support away -> the top piece lands', () => {
  // A 가 (5,0,0) 으로 옮겨졌고, A 위에 있던 B 는 (0,1,0) 에 떠 있다.
  const pieces = [P(bar2, 5, 0, 0), P(bar2, 0, 1, 0, { color: 'red' })];
  const out = settleAll(pieces);
  assert.deepEqual(out[1].pos, [0, 0, 0]);
  assert.equal(out[1].color, 'red', 'keeps other fields');
  assert.equal(out[0], pieces[0], 'unchanged piece keeps identity');
  assert.notEqual(out, pieces, 'returns a new array');
  assert.deepEqual(pieces[1].pos, [0, 1, 0], 'input not mutated');
});

test('chained stack falls together', () => {
  // A 가 빠진 자리 위로 B(y=1), C(y=2), D(y=3) 가 쌓여 있다.
  const pieces = [P(one, 4, 0, 4), P(one, 0, 1, 0), P(one, 0, 2, 0), P(bar2, 0, 3, 0)];
  const out = settleAll(pieces);
  assert.deepEqual(out.map((p) => p.pos[1]), [0, 0, 1, 2]);
  // 겹침 없음
  assert.equal(occupiedSet(out, -1).size, out.reduce((s, p) => s + p.cells.length, 0));
});

test('stable layout is a no-op', () => {
  const pieces = [P(bar2, 0, 0, 0), P(one, 1, 1, 0), P(one, 3, 0, 0)];
  const out = settleAll(pieces);
  out.forEach((p, i) => assert.equal(p, pieces[i]));
});

test('partly supported piece stays (any cell resting is enough)', () => {
  // B 는 한 칸만 A 위에 걸쳐 있다.
  const pieces = [P(one, 0, 0, 0), P(bar2, 0, 1, 0)];
  assert.equal(settleAll(pieces)[1], pieces[1]);
});

test('falls under an overhang instead of dropping from the sky', () => {
  // ㄱ자 A: 바닥 (0,0,0) + 위 (0,1,0),(1,1,0). B 는 A 팔 밑 (1,?,0) 에 떠 있다(y=0 이어야 함).
  // 위에서 떨어뜨리면 A 팔 위로 올라가 버리므로, 아래로만 내려와야 한다.
  const hook = [[0, 0, 0], [0, 1, 0], [1, 1, 0]];
  const pieces = [P(hook, 0, 0, 0), P(one, 1, 0, 0), P(one, 3, 2, 0)];
  const out = settleAll(pieces);
  assert.equal(out[1], pieces[1]);
  assert.deepEqual(out[2].pos, [3, 0, 0]);
});

test('exceptIndex: the held piece is not moved but still supports others', () => {
  // 0 번(끄는 중)은 공중 y=2 에 있어도 그대로, 그 위 1 번은 0 번 위에 머문다.
  // 0 번이 받쳐 주지 않는 2 번은 떨어진다.
  const pieces = [P(one, 0, 2, 0), P(one, 0, 3, 0), P(one, 5, 1, 0)];
  const out = settleAll(pieces, 0);
  assert.equal(out[0], pieces[0]);
  assert.equal(out[1], pieces[1]);
  assert.deepEqual(out[2].pos, [5, 0, 0]);
});
