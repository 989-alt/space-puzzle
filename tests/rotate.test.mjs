// 링으로 돌리기(rotatePiece) — 제자리에서 돌고, 옆 조각 위로 올라타지 않고, 떠 있는 조각이 없고,
// 판 밖에서 돌린 조각이 판 칸으로 들어가지 않는다(2026-10-22 감사: 판 위 회전 4.5%가 옆 조각 위로 올라탔다).
import test from 'node:test';
import assert from 'node:assert/strict';
import { rotatePiece, fits, boardCenter, ISLAND_R } from '../src/core/layout.js';
import { worldCells, settleAll, dropY, occupiedSet } from '../src/core/board.js';
import { footprint } from '../src/core/clues.js';
import { key, normalize, orientations } from '../src/core/pieces.js';
import { loadBanks, startState, mulberry32 } from '../tools/audit-puzzles.mjs';

const center = { x: 2, z: 1.5 };
const SHAPES = {
  domino: [[0, 0, 0], [1, 0, 0]],
  i3: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
  i4: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]],
  square: [[0, 0, 0], [0, 0, 1], [1, 0, 0], [1, 0, 1]],
  l3: [[0, 0, 0], [0, 0, 1], [1, 0, 0]],
  l4: [[0, 0, 0], [0, 0, 1], [0, 0, 2], [1, 0, 2]],
  t4: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [1, 0, 1]],
  step: [[0, 0, 0], [1, 0, 0], [1, 1, 0], [1, 0, 1]],
};
const sig = (p) => `${normalize(p.cells).map(key).join(';')}@${p.pos.join(',')}`;
const colCentre = (p) => {
  const w = worldCells(p);
  const xs = w.map((c) => c[0]);
  const zs = w.map((c) => c[2]);
  return [(Math.min(...xs) + Math.max(...xs) + 1) / 2, (Math.min(...zs) + Math.max(...zs) + 1) / 2];
};
// 받침: y > 0 인 조각은 쌓기나무 하나 이상이 바로 아래 칸(다른 조각)에 얹혀 있어야 한다.
function floating(pieces) {
  const bad = [];
  pieces.forEach((p, i) => {
    if (p.pos[1] === 0) return;
    const occ = occupiedSet(pieces, i);
    if (!worldCells(p).some((c) => occ.has(key([c[0], c[1] - 1, c[2]])))) bad.push(i);
  });
  return bad;
}
function overlaps(pieces) {
  const seen = new Set();
  for (const p of pieces) {
    for (const c of worldCells(p)) {
      if (seen.has(key(c))) return true;
      seen.add(key(c));
    }
  }
  return false;
}

test('rotating a lone piece keeps it in place and four turns bring it back exactly', () => {
  for (const [name, cells] of Object.entries(SHAPES)) {
    for (const axis of ['y', 'x', 'z']) {
      const start = { cells, pos: [1, 0, 1] };
      let p = start;
      const c0 = colCentre(start);
      for (let k = 0; k < 4; k++) {
        p = rotatePiece(p, axis, [p], center);
        assert.ok(fits(p.cells, p.pos[0], p.pos[2], center), `${name} ${axis} fits`);
        const [cx, cz] = colCentre(p);
        // 바닥 모양 가운데가 한 칸 넘게(세우기·뒤집기로 길이가 바뀌면 그 절반 더) 움직이지 않는다.
        // (길이가 짝수인 조각은 칸 가운데를 축으로 돌므로 반 바퀴에 한 칸까지 옮겨 보인다 — 피할 수 없다)
        const lim = 1 + (axis === 'y' ? 0 : Math.max(...cells.map((c) => Math.max(c[0], c[2]))) / 2);
        assert.ok(Math.abs(cx - c0[0]) <= lim && Math.abs(cz - c0[1]) <= lim, `${name} ${axis} turn ${k + 1} moved to ${cx},${cz} from ${c0}`);
        assert.equal(p.pos[1], 0, `${name} ${axis} on floor`);
      }
      assert.equal(sig(p), sig(start), `${name} ${axis} four turns`);
    }
  }
});

test('a y turn of a lone piece never moves its footprint centre by more than half a cell', () => {
  for (const [name, cells] of Object.entries(SHAPES)) {
    const p = { cells, pos: [1, 0, 1] };
    const r = rotatePiece(p, 'y', [p], center);
    const a = colCentre(p);
    const b = colCentre(r);
    assert.ok(Math.abs(a[0] - b[0]) <= 0.5 && Math.abs(a[1] - b[1]) <= 0.5, `${name} ${a} -> ${b}`);
  }
});

test('rotating next to a neighbour moves aside at the same height instead of climbing on it', () => {
  // 가로 막대(3칸) 바로 앞에 쌓기나무 하나. 막대를 세로로 돌리면 가운데 칸 앞이 겹친다.
  // (가운데 칸 앞, 왼쪽 칸 앞 두 경우: 예전 최소 모서리 기준 회전은 왼쪽 칸 앞 쌓기나무 위로 올라탔다)
  for (const bx of [1, 0]) {
    const bar = { cells: SHAPES.i3, pos: [0, 0, 0] };
    const block = { cells: [[0, 0, 0]], pos: [bx, 0, 1] };
    const r = rotatePiece(bar, 'y', [bar, block], center);
    assert.equal(r.pos[1], 0, `climbed: ${JSON.stringify(r)}`);
    assert.ok(!overlaps([r, block]));
    const [cx, cz] = colCentre(r);
    assert.ok(Math.hypot(cx - 1.5, cz - 0.5) <= 2, `moved too far ${cx},${cz}`);
  }
  // 2층에 얹힌 조각도 2층에서 옆으로 비킨다(더 높이 올라가지 않는다)
  const base = { cells: [[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 0, 1], [1, 0, 1], [2, 0, 1]], pos: [0, 0, 0] };
  const tower = { cells: [[0, 0, 0]], pos: [1, 1, 1] };
  const top = { cells: SHAPES.i3, pos: [0, 1, 0] };
  const t = rotatePiece(top, 'y', [base, tower, top], center);
  assert.ok(t.pos[1] <= 1, `climbed onto tower: ${JSON.stringify(t)}`);
  assert.ok(!overlaps([base, tower, t]));
});

test('when there is no room at the same height the piece still ends up somewhere valid', () => {
  // 사방이 높은 벽으로 막힌 칸 안에서 돌린다 -> 올라가도 되지만 겹치거나 작업대 밖이면 안 된다
  const wall = [];
  for (let x = -2; x <= 5; x++) for (let z = -2; z <= 4; z++) for (let y = 0; y < 2; y++) wall.push([x + 2, y, z + 2]);
  const bar = { cells: SHAPES.i3, pos: [0, 0, 0] };
  const walls = { cells: normalize(wall.filter(([x, , z]) => !(z === 2 && x >= 2 && x <= 4))), pos: [-2, 0, -2] };
  const r = rotatePiece(bar, 'y', [bar, walls], center);
  assert.ok(!overlaps([r, walls]));
  assert.ok(fits(r.cells, r.pos[0], r.pos[2], center));
  assert.equal(r.pos[1], dropY(r.cells, r.pos[0], r.pos[2], occupiedSet([walls], -1)));
});

const bank = loadBanks();

test('off-board rotations at the start spots never enter the board or climb on other pieces (160 puzzles x 2 seeds)', () => {
  const bad = [];
  for (const p of bank) {
    const fp = footprint(p.target);
    const c = boardCenter(fp);
    for (const seed of [1, 2]) {
      const ps = startState(p, seed);
      ps.forEach((q, i) => {
        for (const axis of ['y', 'x', 'z']) {
          let cur = ps.slice();
          for (let k = 0; k < 3; k++) {
            const r = rotatePiece(cur[i], axis, cur, c, fp.cells);
            cur = settleAll(cur.map((s, j) => (j === i ? r : s)));
            const w = worldCells(cur[i]);
            if (w.some((cc) => fp.cells.has(`${cc[0]},${cc[2]}`))) bad.push(`${p.id}#${seed} p${i} ${axis}x${k + 1} on board`);
            if (cur[i].pos[1] !== 0) bad.push(`${p.id}#${seed} p${i} ${axis}x${k + 1} climbed y=${cur[i].pos[1]}`);
            if (!fits(cur[i].cells, cur[i].pos[0], cur[i].pos[2], c)) bad.push(`${p.id}#${seed} p${i} outside`);
            if (overlaps(cur)) bad.push(`${p.id}#${seed} p${i} overlap`);
          }
        }
      });
    }
  }
  assert.deepEqual(bad.slice(0, 10), []);
});

test('random rotations never leave floating or overlapping pieces and never climb when room exists', () => {
  const rng = mulberry32(5);
  const R = 2;
  let climbs = 0;
  let climbsWithRoom = 0;
  let n = 0;
  for (const p of bank) {
    const fp = footprint(p.target);
    const c = boardCenter(fp);
    let ps = startState(p, 1);
    for (let step = 0; step < 12; step++) {
      const i = Math.floor(rng() * ps.length);
      if (rng() < 0.4) {
        // 판 칸 위 아무 데나 옮겨 쌓는다(게임처럼 movePiece 대신 위에서 떨어뜨림)
        const cols = [...fp.cells];
        const [x, z] = cols[Math.floor(rng() * cols.length)].split(',').map(Number);
        const occ = occupiedSet(ps, i);
        const moved = { cells: ps[i].cells, pos: [x, dropY(ps[i].cells, x, z, occ), z] };
        if (!fits(moved.cells, x, z, c)) continue;
        ps = settleAll(ps.map((s, j) => (j === i ? moved : s)));
        continue;
      }
      const axis = ['y', 'x', 'z'][Math.floor(rng() * 3)];
      const y0 = ps[i].pos[1];
      const r = rotatePiece(ps[i], axis, ps, c, fp.cells);
      n++;
      ps = settleAll(ps.map((s, j) => (j === i ? r : s)));
      assert.deepEqual(floating(ps), [], `${p.id} floating after rotate`);
      assert.ok(!overlaps(ps), `${p.id} overlap after rotate`);
      assert.ok(fits(ps[i].cells, ps[i].pos[0], ps[i].pos[2], c), `${p.id} outside`);
      if (r.pos[1] > y0) {
        climbs++;
        // 같은 높이 이하로 놓을 자리가 반경 R 안에 있었는가(따로 셈)
        const occ = occupiedSet(ps, i);
        let room = false;
        for (let dx = -R; dx <= R && !room; dx++) {
          for (let dz = -R; dz <= R && !room; dz++) {
            const x = r.pos[0] + dx;
            const z = r.pos[2] + dz;
            if (fits(r.cells, x, z, c) && dropY(r.cells, x, z, occ) <= y0) room = true;
          }
        }
        if (room) climbsWithRoom++;
      }
    }
  }
  assert.ok(n > 1000, `rotations ${n}`);
  assert.equal(climbsWithRoom, 0, `climbs ${climbs}, with room ${climbsWithRoom}`);
});

test('rotatePiece does not mutate its inputs', () => {
  const a = { cells: SHAPES.l4.map((c) => [...c]), pos: [0, 0, 0] };
  const b = { cells: [[0, 0, 0]], pos: [1, 0, 1] };
  const snap = JSON.stringify([a, b]);
  rotatePiece(a, 'y', [a, b], center);
  rotatePiece(a, 'x', [a, b], center, new Set(['0,0']));
  assert.equal(JSON.stringify([a, b]), snap);
  assert.ok(ISLAND_R > 0);
});

test('regression: upright I4 beside the board (s3-008) never rotates into board cells', () => {
  const p = bank.find((e) => e.id === 's3-008');
  const fp = footprint(p.target);
  const c = boardCenter(fp);
  const i4 = [[0, 0, 0], [0, 1, 0], [0, 2, 0], [0, 3, 0]];
  for (const z of [0, 1, 2]) {
    const piece = { cells: i4, pos: [-3, 0, z] };
    for (const axis of ['x', 'y', 'z']) {
      const r = rotatePiece(piece, axis, [piece], c, fp.cells);
      const w = worldCells(r);
      assert.ok(!w.some((q) => fp.cells.has(`${q[0]},${q[2]}`)), `z=${z} ${axis} entered board ${JSON.stringify(r)}`);
      assert.ok(fits(r.cells, r.pos[0], r.pos[2], c), `z=${z} ${axis} outside`);
    }
  }
});

test('off-board rotations anywhere on the workbench never enter the board (sampled sweep)', () => {
  const bad = [];
  let n = 0;
  for (const p of bank.filter((_, k) => k % 8 === 0)) {
    const fp = footprint(p.target);
    const c = boardCenter(fp);
    for (const src of p.pieces) {
      for (const cells of orientations(src)) {
        for (let x = -9; x <= 12; x += 1) {
          for (let z = -9; z <= 12; z += 1) {
            if (!fits(cells, x, z, c)) continue;
            if (cells.some((q) => fp.cells.has(`${x + q[0]},${z + q[2]}`))) continue;
            const piece = { cells, pos: [x, 0, z] };
            for (const axis of ['x', 'y', 'z']) {
              n++;
              const r = rotatePiece(piece, axis, [piece], c, fp.cells);
              if (worldCells(r).some((q) => fp.cells.has(`${q[0]},${q[2]}`))) bad.push(`${p.id} ${x},${z} ${axis}`);
              if (!fits(r.cells, r.pos[0], r.pos[2], c)) bad.push(`${p.id} ${x},${z} ${axis} outside`);
            }
          }
        }
      }
    }
  }
  assert.ok(n > 50000, `rotations ${n}`);
  assert.deepEqual(bad.slice(0, 10), []);
});
