// 끌기 한 걸음(dragStep). 예전 끌기는 바닥(y=0) 평면의 손가락 점을 따라가, 쌓인 조각 윗면을 가리켜도
// 조각이 그 뒤 바닥으로 갔다(2026-10-22: 2칸 깊이 판 윗면을 가리키면 2칸 뒤 바닥에 놓임).
// 이제 잡은 점이 손가락 광선 위에 오고 실제로 그 높이에 놓일 수 있는 자리 중, 칸에 맞춘 잡은 점이 손가락 점에
// 가장 가까운 곳(화면에서 손가락 바로 아래로 보이는 곳)으로 간다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dragStep, fits } from '../src/core/layout.js';
import { worldCells, dropY, occupiedSet } from '../src/core/board.js';
import { key } from '../src/core/pieces.js';

const center = { x: 1.5, z: 1 };
const K = 1.43; // 카메라가 앞(+z)·위에서 약 35도로 내려다본다: 한 칸 높을수록 같은 손가락 점이 1.43칸 앞
// 손가락: 바닥(y=0)에서 (fx, fz) 를 가리키는 광선. 높이 y 평면과 만나는 점.
const finger = (fx, fz) => (y) => ({ x: fx, z: fz + K * y });
// 판 좌표 점 (x, y, z) 를 가리키는 손가락
const at = (x, y, z) => finger(x, z - K * y);
const TOP = { off: [0.5, 0.5], gy: 1 }; // 쌓기나무 하나의 윗면 가운데를 잡음

const cube = (pos) => ({ cells: [[0, 0, 0]], pos });
// 깊이 d, 너비 w, 높이 h 인 받침(x 1.., z 0..)
function slab(w, d, h = 1) {
  const cells = [];
  for (let x = 0; x < w; x++) for (let z = 0; z < d; z++) for (let y = 0; y < h; y++) cells.push([x, y, z]);
  return { cells, pos: [1, 0, 0] };
}
// 손가락을 a 에서 b 까지 조금씩 옮기며 dragStep(null 이면 그대로)
function drag(piece, others, from, to, grab = TOP, steps = 40) {
  let p = piece;
  for (let k = 1; k <= steps; k++) {
    const t = k / steps;
    const f = finger(from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t);
    const next = dragStep(p, f, grab, [p, ...others], center);
    if (next) p = next;
  }
  return p;
}
const floorOf = (x, y, z) => [x, z - K * y]; // 판 점 (x,y,z)를 가리키는 손가락의 바닥 점

test('on the floor the grabbed point lands under the finger', () => {
  const p = cube([-1, 0, 3]);
  const r = dragStep(p, at(3.5, 1, 2.5), TOP, [p], center);
  assert.deepEqual(r.pos, [3, 0, 2]);
});

test('pointing at the top of a 2-deep slab puts the piece on it (not on the floor behind)', () => {
  const s = slab(3, 2);
  const p = cube([-1, 0, 3]);
  // 앞에서 끌어와 판 뒷줄(z=0) 윗면을 가리킨다
  const r = drag(p, [s], floorOf(-0.5, 1, 3.5), floorOf(1.5, 2, 0.5));
  assert.deepEqual(r.pos, [1, 1, 0]);
});

test('pointing at the top of a single cube puts the piece on it (1-deep wall)', () => {
  const s = slab(1, 1);
  const p = cube([-1, 0, 3]);
  const r = drag(p, [s], floorOf(-0.5, 1, 3.5), floorOf(1.5, 2, 0.5));
  assert.deepEqual(r.pos, [1, 1, 0]);
});

test('pointing at the floor behind a slab puts the piece on that floor', () => {
  const s = slab(3, 1);
  const p = cube([-1, 0, 3]);
  const r = drag(p, [s], floorOf(-0.5, 1, 3.5), floorOf(2.5, 1, -1.5));
  assert.deepEqual(r.pos, [2, 0, -2]);
});

test('a piece resting behind a wall does not hop onto it when the drag starts', () => {
  const s = slab(3, 1);
  const p = cube([2, 0, -1]); // 벽 바로 뒤 바닥
  const r = dragStep(p, at(2.5, 1, -0.5), TOP, [p, s], center);
  assert.deepEqual(r.pos, [2, 0, -1]);
});

test('the finger on the front face of a wall leaves the piece where it was (no consistent spot)', () => {
  const s = slab(3, 2, 2); // 2층 벽
  const p = cube([2, 0, 3]);
  // 앞면(z=2, 높이 1.6) 을 가리킨다: 바닥 자리는 벽 안, 위 자리는 벽 앞 허공
  assert.equal(dragStep(p, at(2.5, 1.6, 2), TOP, [p, s], center), null);
});

test('drag results never overlap, always fit and rest at dropY', () => {
  const others = [slab(3, 2), cube([0, 0, 3])];
  const occ = occupiedSet(others, -1);
  const p = { cells: [[0, 0, 0], [1, 0, 0], [1, 1, 0]], pos: [-2, 0, 2] };
  for (let fx = -4; fx <= 6; fx += 0.37) {
    for (let fz = -4; fz <= 6; fz += 0.41) {
      const r = dragStep(p, finger(fx, fz), { off: [0.5, 0.5], gy: 1 }, [p, ...others], center);
      if (!r) continue;
      assert.ok(fits(r.cells, r.pos[0], r.pos[2], center));
      assert.equal(r.pos[1], dropY(r.cells, r.pos[0], r.pos[2], occ));
      const mine = new Set(worldCells(r).map(key));
      for (const k of occ) assert.ok(!mine.has(k));
    }
  }
});
