import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesClue, judge } from '../src/core/judge.js';
import { hasOverhang, footprint, topCounts, frontView, sideView } from '../src/core/clues.js';

// 높이 표(행 = z 오름차순 뒤→앞, 열 = x)에서 칸 목록을 만든다.
function cellsFromHeights(rows) {
  const cells = [];
  rows.forEach((row, z) => row.forEach((h, x) => { for (let y = 0; y < h; y++) cells.push([x, y, z]); }));
  return cells;
}

const T = cellsFromHeights([[2, 2, 2, 1], [2, 1, 1, 1]]);

// 시안 문제의 분할(Task 3 DEFS와 같음). 모두 pos [0,0,0]이라 cells = 월드 칸.
const PROTO = [
  { cells: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]], pos: [0, 0, 0] },
  { cells: [[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]], pos: [0, 0, 0] },
  { cells: [[1, 1, 0], [2, 1, 0], [2, 0, 0], [3, 0, 0]], pos: [0, 0, 0] },
];

const sortedKeys = (cells) => cells.map((c) => c.join(',')).sort();

test('prototype partition covers target exactly', () =>
  assert.deepEqual(sortedKeys(PROTO.flatMap((p) => p.cells)), sortedKeys(T)));

test('every level accepts the exact target', () => {
  for (const level of [1, 2, 3, 4]) assert.equal(matchesClue(T, T, level), true, `level ${level}`);
});

test('level 4 accepts a different shape with same three views', () => {
  const A = cellsFromHeights([[2, 1], [1, 2]]), B = cellsFromHeights([[1, 2], [2, 1]]);
  assert.equal(matchesClue(B, A, 4), true);
  assert.equal(matchesClue(B, A, 3), false);
});

test('level 1-3 reject a different cell set', () => {
  const A = cellsFromHeights([[2, 1], [1, 2]]), B = cellsFromHeights([[1, 2], [2, 1]]);
  for (const level of [1, 2, 3]) assert.equal(matchesClue(B, A, level), false, `level ${level}`);
});

test('level 4 rejects overhang even if views match', () => {
  // T에서 앞줄 x=1 바닥 칸 (1,0,1)을 빼고 그 위 (1,1,1)에 띄운다: 칸 수·위·앞·옆 모양은 같고 아래가 빈다.
  const O = T.filter((c) => c.join(',') !== '1,0,1').concat([[1, 1, 1]]);
  const fp = footprint(T);
  assert.equal(O.length, T.length);
  assert.equal(hasOverhang(O), true);
  assert.deepEqual(topCounts(O, fp), topCounts(T, fp));
  assert.deepEqual(frontView(O, fp), frontView(T, fp));
  assert.deepEqual(sideView(O, fp), sideView(T, fp));
  assert.equal(matchesClue(O, T, 4), false);
});

test('level 4 rejects a taller shape without crashing', () => {
  const A = cellsFromHeights([[2, 1], [1, 2]]);
  const tall = cellsFromHeights([[3, 1], [1, 1]]);
  assert.equal(matchesClue(tall, A, 4), false);
});

test('level 4 rejects cells off the footprint', () => {
  const A = cellsFromHeights([[1, 1], [1, 1]]);
  assert.equal(matchesClue([[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [2, 0, 0]], A, 4), false);
});

test('level 1-3 reject overlapping (duplicate) cells', () => {
  const A = cellsFromHeights([[1, 1]]);
  assert.equal(matchesClue([[0, 0, 0], [1, 0, 0], [1, 0, 0]], A, 1), false);
});

test('judge incomplete when a piece is off the board', () =>
  assert.equal(judge([{ cells: [[0, 0, 0]], pos: [9, 0, 9] }], T, 1), 'incomplete'));

test('judge incomplete when one of several pieces is off the board', () =>
  assert.equal(judge([PROTO[0], PROTO[1], { ...PROTO[2], pos: [0, 0, 5] }], T, 4), 'incomplete'));

test('judge mismatch when all on board but wrong', () => {
  // 모든 칸이 판 위지만 2층이 없는 납작한 모양
  const flat = [
    { cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], pos: [0, 0, 0] },
    { cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], pos: [0, 0, 1] },
  ];
  for (const level of [1, 2, 3, 4]) assert.equal(judge(flat, T, level), 'mismatch', `level ${level}`);
});

test('judge solved for exact target', () => {
  for (const level of [1, 2, 3, 4]) assert.equal(judge(PROTO, T, level), 'solved', `level ${level}`);
});

test('judge uses pos offsets', () => {
  const shifted = [{ cells: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]], pos: [0, 0, 0] },
    { cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], pos: [0, 0, 1] },
    { cells: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [2, 0, 0]], pos: [1, 0, 0] }];
  assert.equal(judge(shifted, T, 1), 'solved');
});
