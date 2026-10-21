import test from 'node:test';
import assert from 'node:assert/strict';
import { solve, dropOrderExists } from '../src/core/solver.js';
import { worldCells } from '../src/core/board.js';
import { key, normalize, orientations } from '../src/core/pieces.js';

// 높이 표(행 = z 오름차순 뒤→앞, 열 = x)에서 칸 목록을 만든다.
function cellsFromHeights(rows) {
  const cells = [];
  rows.forEach((row, z) => row.forEach((h, x) => { for (let y = 0; y < h; y++) cells.push([x, y, z]); }));
  return cells;
}

const T = cellsFromHeights([[2, 2, 2, 1], [2, 1, 1, 1]]);
const DEFS = [
  { cells: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]] },
  { cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]] },
  { cells: [[0, 1, 0], [1, 1, 0], [1, 0, 0], [2, 0, 0]] },
];

const sortedKeys = (cells) => cells.map(key).sort();

// 2×2×2 정육면체를 서로 맞물린 두 조각으로 나눈 배치.
// A는 기둥 (1,0)에서 B 위에, B는 기둥 (0,1)에서 A 위에 있어 어느 쪽도 먼저 놓을 수 없다.
const LOCK_A = [[0, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1]];
const LOCK_B = [[1, 0, 0], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const CUBE = cellsFromHeights([[2, 2], [2, 2]]);

test('prototype puzzle is solvable', () => assert.ok(solve(T, DEFS.map((d) => d.cells)).count >= 1));

test('impossible cell count gives 0', () => assert.equal(solve(T, [[[0, 0, 0]]]).count, 0));

test('every solution covers the target exactly with each piece in a real orientation', () => {
  const r = solve(T, DEFS.map((d) => d.cells));
  assert.equal(r.solutions.length, r.count);
  for (const sol of r.solutions) {
    assert.equal(sol.length, DEFS.length);
    assert.deepEqual(sortedKeys(sol.flatMap(worldCells)), sortedKeys(T));
    sol.forEach((p, i) => {
      const sigs = orientations(DEFS[i].cells).map((o) => sortedKeys(o).join(';'));
      assert.ok(sigs.includes(sortedKeys(normalize(p.cells)).join(';')), `piece ${i} shape`);
    });
    assert.equal(dropOrderExists(sol), true);
  }
});

test('prototype partition itself is one of the solutions', () => {
  const r = solve(T, DEFS.map((d) => d.cells), { limit: 1000 });
  const want = JSON.stringify([
    [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1]],
    [[1, 1, 0], [2, 1, 0], [2, 0, 0], [3, 0, 0]],
  ].map(sortedKeys));
  assert.ok(r.solutions.some((s) => JSON.stringify(s.map((p) => sortedKeys(worldCells(p)))) === want));
});

test('limit caps the number of solutions returned', () => {
  // 1×1×1 조각 4개로 2×2 바닥 채우기: 같은 모양은 한 번만 세므로 해답은 1개.
  const flat = cellsFromHeights([[1, 1], [1, 1]]);
  const unit = [[0, 0, 0]];
  assert.equal(solve(flat, [unit, unit, unit, unit]).count, 1);
  // 1×2 조각 두 개(같은 모양): 가로 둘 / 세로 둘 → 2가지.
  const domino = [[0, 0, 0], [1, 0, 0]];
  assert.equal(solve(flat, [domino, domino]).count, 2);
  assert.equal(solve(flat, [domino, domino], { limit: 1 }).count, 1);
  assert.equal(solve(flat, [domino, domino], { limit: 1 }).solutions.length, 1);
});

test('drop order: a piece resting on another is placeable after it', () => {
  const placements = DEFS.map((d, i) => ({
    cells: [
      [[0, 0, 0], [0, 1, 0], [0, 1, 1], [1, 0, 0]],
      [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
      [[0, 1, 0], [1, 1, 0], [1, 0, 0], [2, 0, 0]],
    ][i],
    pos: [[0, 0, 0], [0, 0, 1], [1, 0, 0]][i],
  }));
  assert.equal(dropOrderExists(placements), true);
});

test('drop order rejects slide-under placement', () => {
  const placements = [
    { cells: LOCK_A, pos: [0, 0, 0] },
    { cells: normalize(LOCK_B), pos: [0, 0, 0] },
  ];
  // 두 조각이 정확히 정육면체를 채우지만(맞물림), 어느 순서로도 위에서 떨어뜨릴 수 없다.
  assert.deepEqual(sortedKeys(placements.flatMap(worldCells)), sortedKeys(CUBE));
  assert.equal(dropOrderExists(placements), false);
});

test('drop order needs the under-piece first even if the upper piece is droppable on the floor first', () => {
  // L 조각의 (1,1,0)이 단위 칸 (1,0,0) 위를 덮는다. L을 먼저 놓으면 단위 칸이 못 들어가므로
  // 탐욕 순서가 아니라 순서 탐색이 필요하다.
  const placements = [
    { cells: [[0, 0, 0], [0, 1, 0], [1, 1, 0]], pos: [0, 0, 0] },
    { cells: [[0, 0, 0]], pos: [1, 0, 0] },
  ];
  assert.equal(dropOrderExists(placements), true);
});

test('drop order rejects a floating piece', () => {
  assert.equal(dropOrderExists([{ cells: [[0, 0, 0]], pos: [0, 1, 0] }]), false);
});

test('solver counts only drop-orderable covers', () => {
  const raw = solve(CUBE, [LOCK_A, LOCK_B], { limit: 1000, dropCheck: false });
  const real = solve(CUBE, [LOCK_A, LOCK_B], { limit: 1000 });
  assert.ok(raw.count > real.count, `raw ${raw.count} real ${real.count}`);
  for (const sol of real.solutions) assert.equal(dropOrderExists(sol), true);
  assert.ok(raw.solutions.some((sol) => !dropOrderExists(sol)));
});
