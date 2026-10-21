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
const LABEL_EXEMPT = [];

const colsOf = (cells, x, z) => cells.map((c) => [x + c[0], z + c[2]]);
const near = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;

test('constants and helpers', () => {
  assert.equal(ISLAND_R, 6);
  assert.deepEqual(boardCenter({ w: 5, d: 4 }), { x: 2.5, z: 2 });
  // 앞(90도)은 "앞" 표시 통로라 비운다(R14). 뒤(270도) 대신 화면 겹침이 가장 적은 각도(R17).
  assert.deepEqual(startAngles(3), [180, 0, 45]);
  assert.deepEqual(startAngles(4), [180, 135, 45, 0]);
  assert.deepEqual(startAngles(5), [180, 135, 45, 0, 225]);
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
          // "앞" 표시 바로 앞 통로(z >= d + 1, x 가 floor(w/2)-1 .. ceil(w/2))는 비워 둔다.
          // LABEL_EXEMPT 문제는 통로까지 비우면 놓을 자리가 없어 통로를 쓰는 예비 배치로 놓인다.
          if (!LABEL_EXEMPT.includes(p.id)) {
            assert.ok(!(col[1] >= fp.d + 1 && col[0] >= Math.floor(fp.w / 2) - 1 && col[0] <= Math.ceil(fp.w / 2)),
              `${p.id}#${seed} piece ${i} blocks the front label corridor`);
          }
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

test('starts are tidy: left, right, front-right (long side along x)', () => {
  const p = bank.find((e) => e.id === 's1-001');
  const fp = footprint(p.target);
  const center = boardCenter(fp);
  const st = placeStarts(p.pieces, fp, mulberry32(3));
  const mid = (s) => {
    const [w, , d] = dims(s.cells);
    return [s.x + w / 2, s.z + d / 2];
  };
  assert.ok(mid(st[0])[0] < center.x, 'angle 180 is left');
  assert.ok(mid(st[1])[0] > center.x, 'angle 0 is right');
  assert.ok(mid(st[2])[0] > center.x && mid(st[2])[1] > center.z, 'angle 45 is front-right');
  const [w2, , d2] = dims(st[2].cells);
  assert.ok(w2 >= d2, 'front-right piece lies along x');
});

// R16a: 뒤쪽(5개일 때 225도) 조각은 작업대 끝으로 간다. 그 방향(x − 1, z − 1)으로 한 칸 더 옮기면
// 작업대를 벗어나거나 판·다른 조각 둘레에 닿아야 한다(160문제 × 시드).
test('back start piece sits at the farthest fitting spot (all 160 puzzles x seeds)', () => {
  const bad = [];
  let checked = 0;
  for (const p of bank) {
    const angles = startAngles(p.pieces.length);
    const bi = angles.findIndex((a) => Math.sin((a * Math.PI) / 180) < -0.7);
    if (bi < 0) continue;
    const fp = footprint(p.target);
    const center = boardCenter(fp);
    const boardCols = [...fp.cells].map((k) => k.split(',').map(Number));
    for (const seed of SEEDS) {
      const st = placeStarts(p.pieces, fp, mulberry32(seed));
      const b = st[bi];
      const others = st.filter((_, j) => j !== bi).flatMap((s) => colsOf(s.cells, s.x, s.z));
      const a = (angles[bi] * Math.PI) / 180;
      const x = b.x + Math.sign(Math.round(Math.cos(a) * 10));
      const z = b.z + Math.sign(Math.round(Math.sin(a) * 10));
      const clear = fits(b.cells, x, z, center)
        && colsOf(b.cells, x, z).every((c) => !boardCols.some((q) => near(c, q)) && !others.some((q) => near(c, q)));
      if (clear) bad.push(`${p.id}#${seed}`);
      checked++;
    }
  }
  assert.ok(checked >= 24, `checked ${checked}`);
  assert.deepEqual(bad, []);
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

// 화면 UI(단서 카드 등) 아래로 들어가는 칸은 시작 자리에서 뺀다(avoid). 자리가 없으면 avoid 없이 다시 찾는다.
test('placeStarts keeps pieces out of avoid columns (all 160 puzzles, seed 1)', () => {
  const bad = [];
  let moved = 0;
  for (const p of bank) {
    const fp = footprint(p.target);
    const center = boardCenter(fp);
    // 판 중심 오른쪽 3.5칸 이상, 뒤쪽 절반(z < 중심)인 칸을 UI 아래라고 친다.
    const avoid = new Set();
    for (let x = Math.floor(center.x + 3); x <= Math.ceil(center.x + 6); x++) {
      for (let z = Math.floor(center.z - 6); z <= Math.ceil(center.z + 0.5); z++) avoid.add(`${x},${z}`);
    }
    const st = placeStarts(p.pieces, fp, mulberry32(1), undefined, avoid);
    const hit = st.some((s) => colsOf(s.cells, s.x, s.z).some(([x, z]) => avoid.has(`${x},${z}`)));
    if (hit) bad.push(p.id);
    const plain = placeStarts(p.pieces, fp, mulberry32(1));
    if (JSON.stringify(plain) !== JSON.stringify(st)) moved++;
  }
  assert.deepEqual(bad, []);
  assert.ok(moved > 0, 'avoid should change at least one layout');
});

test('placeStarts falls back to ignoring avoid when it leaves no room', () => {
  const p = bank.find((e) => e.id === 's4-006');
  const fp = footprint(p.target);
  const all = new Set();
  for (let x = -10; x <= 20; x++) for (let z = -10; z <= 20; z++) all.add(`${x},${z}`);
  const st = placeStarts(p.pieces, fp, mulberry32(1), undefined, all);
  assert.equal(st.length, p.pieces.length);
});

test('placeStarts is fast enough not to freeze the screen (all 160 puzzles x 5 seeds)', () => {
  // 목표는 이 PC 의 Node 에서 한 번 < 60ms(실측 최악 약 30ms). 다른 시험과 함께 돌 때 흔들림을 감안해 120ms 로 본다.
  placeStarts(bank[0].pieces, footprint(bank[0].target), mulberry32(1)); // JIT 데우기
  let worst = 0;
  let worstId = '';
  for (const p of bank) {
    const fp = footprint(p.target);
    for (const seed of [...SEEDS, 42, 99]) {
      const t0 = performance.now();
      placeStarts(p.pieces, fp, mulberry32(seed));
      const dt = performance.now() - t0;
      if (dt > worst) { worst = dt; worstId = `${p.id}#${seed}`; }
    }
  }
  assert.ok(worst < 120, `worst ${worst.toFixed(1)}ms at ${worstId}`);
});
