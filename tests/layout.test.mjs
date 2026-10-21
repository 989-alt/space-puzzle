import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  ISLAND_R, boardCenter, fits, clampInside, startAngles, placeStarts, movePiece, rotatePiece,
} from '../src/core/layout.js';
import { footprint } from '../src/core/clues.js';
import { dims } from '../src/core/pieces.js';
import { worldCells } from '../src/core/board.js';

// 테스트 전용 시드 난수(src 에는 두지 않는다)
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bank = [1, 2, 3, 4].flatMap((s) => JSON.parse(readFileSync(new URL(`../data/puzzles-s${s}.json`, import.meta.url), 'utf8')));
const SEEDS = [1, 7, 20261021];
const LABEL_ROW_EXEMPT = ['s4-014'];

const colsOf = (cells, x, z) => cells.map((c) => [x + c[0], z + c[2]]);
const near = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

test('constants and helpers', () => {
  assert.equal(ISLAND_R, 6);
  assert.deepEqual(boardCenter({ w: 5, d: 4 }), { x: 2.5, z: 2 });
  assert.deepEqual(startAngles(3), [180, 90, 0]);
  assert.deepEqual(startAngles(4), [180, 135, 45, 0]);
  assert.deepEqual(startAngles(5), [180, 135, 90, 45, 0]);
});

test('fits checks all four corners against r - 0.15', () => {
  const c = { x: 0, z: 0 };
  assert.ok(fits([[0, 0, 0]], 0, 0, c));
  assert.equal(fits([[0, 0, 0]], 4, 4, c), false); // 모서리 (5,5) = 7.07 > 5.85
  assert.equal(fits([[0, 0, 0]], 4, 3, c), false); // (5,4) = 6.40 > 5.85
  assert.equal(fits([[0, 0, 0]], 4, 2, c), true); // (5,3) = 5.83 <= 5.85
  assert.equal(fits([[0, 0, 0]], 4, 3, c, 7), true);
});

test('clamp pulls far drag back inside', () => {
  const cells = [[0, 0, 0], [1, 0, 0]];
  const center = { x: 2, z: 1 };
  const [x, z] = clampInside(cells, 40, 40, center);
  assert.ok(fits(cells, x, z, center));
});

test('clamp leaves an already valid spot alone', () => {
  const cells = [[0, 0, 0], [1, 0, 0]];
  assert.deepEqual(clampInside(cells, 1, 1, { x: 2, z: 1 }), [1, 1]);
});

test('starts never overlap board ring or each other, all fit (all 160 puzzles x seeds)', () => {
  assert.equal(bank.length, 160);
  const failed = [];
  for (const p of bank) {
    const fp = footprint(p.target);
    const center = boardCenter(fp);
    for (const seed of SEEDS) {
      let st;
      try {
        st = placeStarts(p.pieces, fp, mulberry32(seed));
      } catch (e) {
        failed.push(`${p.id}#${seed}: ${e.message}`);
        continue;
      }
      assert.equal(st.length, p.pieces.length);
      const placed = st.map((s) => colsOf(s.cells, s.x, s.z));
      st.forEach((s, i) => {
        assert.ok(Number.isInteger(s.x) && Number.isInteger(s.z), `${p.id} integer`);
        assert.ok(fits(s.cells, s.x, s.z, center), `${p.id}#${seed} piece ${i} fits`);
        assert.equal(s.cells.length, p.pieces[i].length, `${p.id} cell count`);
        for (const col of placed[i]) {
          // 판 바로 앞 한 줄(z = d + 1, x -1..w)은 "앞" 표시 자리라 비워 둔다.
          // s4-014(5조각, 5x4 판)는 이 줄까지 비우면 놓을 자리가 없어 이 줄을 쓰는 예비 배치로 놓인다.
          if (!LABEL_ROW_EXEMPT.includes(p.id)) assert.ok(!(col[1] === fp.d + 1 && col[0] >= -1 && col[0] <= fp.w),
            `${p.id}#${seed} piece ${i} covers the front label row`);
          for (const k of fp.cells) {
            const [bx, bz] = k.split(',').map(Number);
            assert.ok(!near(col, [bx, bz]), `${p.id}#${seed} piece ${i} touches board ring`);
          }
        }
        for (let j = i + 1; j < st.length; j++) {
          for (const a of placed[i]) for (const b of placed[j]) {
            assert.ok(!near(a, b), `${p.id}#${seed} pieces ${i},${j} touch`);
          }
        }
      });
    }
  }
  assert.deepEqual(failed, []);
});

test('starts are tidy: first piece on the left, last on the right, lying flat', () => {
  const p = bank.find((e) => e.id === 's1-001');
  const fp = footprint(p.target);
  const center = boardCenter(fp);
  const st = placeStarts(p.pieces, fp, mulberry32(3));
  const mid = (s) => {
    const [w, , d] = dims(s.cells);
    return [s.x + w / 2, s.z + d / 2];
  };
  assert.ok(mid(st[0])[0] < center.x, 'angle 180 is left');
  assert.ok(mid(st[2])[0] > center.x, 'angle 0 is right');
  assert.ok(mid(st[1])[1] > center.z, 'angle 90 is front');
});

test('starts are deterministic for a seed', () => {
  const p = bank.find((e) => e.id === 's3-005');
  const fp = footprint(p.target);
  assert.deepEqual(placeStarts(p.pieces, fp, mulberry32(9)), placeStarts(p.pieces, fp, mulberry32(9)));
});

test('placeStarts throws naming the cell count when nothing fits', () => {
  const huge = Array.from({ length: 13 }, (_, i) => [i, 0, 0]);
  assert.throws(() => placeStarts([huge], { w: 1, d: 1, cells: new Set(['0,0']) }, mulberry32(1)), /13/);
});

test('movePiece clamps and drops onto others (pieces may include the moved one)', () => {
  const center = { x: 2, z: 1.5 };
  const a = { cells: [[0, 0, 0], [1, 0, 0]], pos: [5, 0, 0] };
  const b = { cells: [[0, 0, 0]], pos: [-3, 0, 0] };
  const moved = movePiece(a, 40, 40, [a, b], center);
  assert.ok(fits(moved.cells, moved.pos[0], moved.pos[2], center));
  assert.notEqual(moved, a);
  assert.deepEqual(a.pos, [5, 0, 0]); // 원본 불변
  const onB = movePiece(a, -3, 0, [a, b], center);
  assert.equal(onB.pos[1], 1);
  assert.deepEqual(onB.pos.slice(0, 1).concat(onB.pos[2]), [-3, 0]);
});

test('rotateNearEdgeStaysInside', () => {
  const center = { x: 2, z: 1.5 };
  const bar = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]];
  // 오른쪽 경계에 최대한 붙여 놓는다
  let x = 0;
  while (fits(bar, x + 1, 1, center)) x++;
  const piece = { cells: bar, pos: [x, 0, 1] };
  const other = { cells: [[0, 0, 0], [0, 0, 1]], pos: [x, 0, 3] };
  const pieces = [piece, other];
  for (const axis of ['y', 'x', 'z']) {
    const r = rotatePiece(piece, axis, pieces, center);
    assert.ok(fits(r.cells, r.pos[0], r.pos[2], center), `axis ${axis} fits`);
    const occ = new Set(worldCells(other).map((c) => c.join(',')));
    for (const c of worldCells(r)) assert.ok(!occ.has(c.join(',')), `axis ${axis} no overlap`);
  }
  const ry = rotatePiece(piece, 'y', pieces, center);
  assert.deepEqual(dims(ry.cells), [1, 1, 4]);
});
