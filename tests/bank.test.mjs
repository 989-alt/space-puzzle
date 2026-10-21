// 문제 은행 전수 검사. tools/gen-puzzles.mjs 가 만든 data/puzzles-s1..4.json 을 읽는다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { solve } from '../src/core/solver.js';
import { hasOverhang, footprint, height } from '../src/core/clues.js';
import { key, normalize, orientations } from '../src/core/pieces.js';

const RULES = {
  1: { pieces: [3, 3], cells: [10, 12], w: 4, d: 3 },
  2: { pieces: [3, 3], cells: [11, 12], w: 4, d: 3 },
  3: { pieces: [4, 4], cells: [13, 16], w: 5, d: 3 },
  4: { pieces: [4, 5], cells: [15, 19], w: 5, d: 4 },
};

const shapeId = (cells) => orientations(cells).map((o) => o.map(key).join(';')).sort()[0];

function connected(cells, nbrs) {
  const set = new Set(cells.map(key));
  const seen = new Set([key(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop();
    for (const d of nbrs) {
      const k = key([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k.split(',').map(Number)); }
    }
  }
  return seen.size === set.size;
}
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N4 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

for (const s of [1, 2, 3, 4]) test(`bank s${s} all solvable and well-formed`, () => {
  const bank = JSON.parse(readFileSync(new URL(`../data/puzzles-s${s}.json`, import.meta.url)));
  assert.ok(bank.length >= 30);
  const r = RULES[s];
  const ids = new Set();
  for (const p of bank) {
    assert.equal(p.stage, s);
    assert.match(p.id, new RegExp(`^s${s}-\\d{3}$`));
    assert.ok(!ids.has(p.id), `duplicate id ${p.id}`);
    ids.add(p.id);
    assert.equal(p.pieces.flat().length, p.target.length);
    assert.equal(new Set(p.target.map(key)).size, p.target.length, `${p.id} target has duplicate cells`);
    assert.equal(hasOverhang(p.target), false);
    assert.ok(solve(p.target, p.pieces, { limit: 1 }).count >= 1, `${p.id} unsolvable`);
    assert.ok(p.solutions >= 1);

    // 생성 규칙
    assert.ok(p.pieces.length >= r.pieces[0] && p.pieces.length <= r.pieces[1], `${p.id} piece count`);
    assert.ok(p.target.length >= r.cells[0] && p.target.length <= r.cells[1], `${p.id} cell count`);
    assert.ok(height(p.target) <= 2 && p.target.every((c) => c[1] >= 0));
    const fp = footprint(p.target);
    assert.ok(fp.w <= r.w && fp.d <= r.d, `${p.id} footprint ${fp.w}x${fp.d}`);
    // 5×4(√41 = 6.403)는 표의 최대 바닥이라 소수 첫째 자리 반올림으로 6.4에 넣는다.
    assert.ok(Math.round(Math.hypot(fp.w, fp.d) * 10) / 10 <= 6.4);
    assert.equal(Math.min(...p.target.map((c) => c[0])), 0);
    assert.equal(Math.min(...p.target.map((c) => c[2])), 0);
    assert.ok(connected(p.target.filter((c) => c[1] === 0), N4), `${p.id} floor not 4-connected`);
    const counts = new Map();
    for (const pc of p.pieces) {
      assert.deepEqual(pc, normalize(pc), `${p.id} piece not normalized`);
      assert.ok(pc.length >= 3 && pc.length <= 5, `${p.id} piece size`);
      assert.ok(connected(pc, N6), `${p.id} piece not connected`);
      const id = shapeId(pc);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    assert.ok(Math.max(...counts.values()) <= 2, `${p.id} same shape more than twice`);
  }
});
