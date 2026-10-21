import test from 'node:test';
import assert from 'node:assert/strict';
import { cellStatus } from '../src/core/ghost.js';

const TARGET = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0]];
const sorted = (set) => [...set].sort();

test('cells on the target are filled, others are wrong', () => {
  const pieces = [
    { cells: [[0, 0, 0], [1, 0, 0]], pos: [0, 0, 0] }, // 둘 다 목표
    { cells: [[0, 0, 0], [0, 1, 0]], pos: [0, 2, 0] }, // 판 위 기둥, 둘 다 목표 밖(목표 위쪽)
  ];
  const r = cellStatus(pieces, TARGET);
  assert.deepEqual(sorted(r.filledTargetCells), ['0,0,0', '1,0,0']);
  assert.deepEqual(sorted(r.wrongCells), ['0,2,0', '0,3,0']);
});

test('a piece waiting off the board is not counted as wrong', () => {
  const pieces = [{ cells: [[0, 0, 0], [0, 1, 0]], pos: [4, 0, 4] }];
  const r = cellStatus(pieces, TARGET);
  assert.equal(r.wrongCells.size, 0);
  assert.equal(r.filledTargetCells.size, 0);
});

test('a piece overhanging the board edge marks its outside cubes wrong', () => {
  const pieces = [{ cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0]], pos: [0, 0, 0] }];
  const r = cellStatus(pieces, TARGET);
  assert.deepEqual(sorted(r.wrongCells), ['2,0,0']);
});

test('a piece half inside the target marks only the outside cubes wrong', () => {
  const pieces = [{ cells: [[0, 0, 0], [1, 0, 0]], pos: [1, 0, 1] }]; // (1,0,1) 안, (2,0,1) 밖
  const r = cellStatus(pieces, TARGET);
  assert.deepEqual(sorted(r.filledTargetCells), ['1,0,1']);
  assert.deepEqual(sorted(r.wrongCells), ['2,0,1']);
});

test('pieces exactly on the target have no wrong cells', () => {
  const pieces = [
    { cells: [[0, 0, 0], [1, 0, 0], [0, 0, 1]], pos: [0, 0, 0] },
    { cells: [[0, 0, 0]], pos: [1, 0, 1] },
    { cells: [[0, 0, 0]], pos: [0, 1, 0] },
  ];
  const r = cellStatus(pieces, TARGET);
  assert.equal(r.wrongCells.size, 0);
  assert.equal(r.filledTargetCells.size, TARGET.length);
});

test('exceptIndex (lifted piece) is ignored', () => {
  const pieces = [
    { cells: [[0, 0, 0]], pos: [5, 0, 5] },
    { cells: [[0, 0, 0]], pos: [0, 0, 0] },
  ];
  const r = cellStatus(pieces, TARGET, 0);
  assert.equal(r.wrongCells.size, 0);
  assert.deepEqual(sorted(r.filledTargetCells), ['0,0,0']);
});

test('no pieces -> nothing filled, nothing wrong', () => {
  const r = cellStatus([], TARGET);
  assert.equal(r.wrongCells.size, 0);
  assert.equal(r.filledTargetCells.size, 0);
});
