import test from 'node:test';
import assert from 'node:assert/strict';
import { worldCells, occupiedSet, dropY } from '../src/core/board.js';

test('dropY on empty floor is 0', () => assert.equal(dropY([[0, 0, 0]], 0, 0, new Set()), 0));

test('dropY lands on top of occupied column', () =>
  assert.equal(dropY([[0, 0, 0]], 2, 1, new Set(['2,0,1', '2,1,1'])), 2));

test('dropY of overhang piece rests on highest support', () =>
  assert.equal(dropY([[0, 0, 0], [1, 0, 0], [1, 1, 0]], 0, 0, new Set(['1,0,0'])), 1));

test('worldCells offsets cells by pos', () =>
  assert.deepEqual(worldCells({ cells: [[0, 0, 0], [1, 0, 0]], pos: [2, 3, 4] }), [[2, 3, 4], [3, 3, 4]]));

test('occupiedSet collects all piece cells except one', () => {
  const pieces = [
    { cells: [[0, 0, 0], [1, 0, 0]], pos: [0, 0, 0] },
    { cells: [[0, 0, 0]], pos: [5, 1, 5] },
  ];
  assert.deepEqual([...occupiedSet(pieces)].sort(), ['0,0,0', '1,0,0', '5,1,5']);
  assert.deepEqual([...occupiedSet(pieces, 0)], ['5,1,5']);
});
