// 문제 은행 전수 감사(tools/audit-puzzles.mjs) A–E. 보고서: docs/audit-2026-10-22.md
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadBanks, checkData, checkReach, checkClues, level4Alternatives, staticConventions,
  expectedScreenClues, renderedClue, playOrder, startState, solutionsOf, validOrders,
} from '../tools/audit-puzzles.mjs';
import { clueFor } from '../src/core/clues.js';

const bank = loadBanks();

test('A data sanity (160 puzzles)', () => {
  assert.equal(bank.length, 160);
  const ids = new Set();
  const bad = bank.map((p) => [p.id, checkData(p, ids)]).filter(([, b]) => b.length);
  assert.deepEqual(bad, []);
});

test('B/C reachable through game mechanics (5 seeds) + at least one drop order', () => {
  const fails = [];
  for (const p of bank) {
    // 시드 1에서만 모든 순서를 놓아 보고 나머지 시드는 첫 순서만(시간)
    const r = checkReach(p, { full: false });
    if (r.fails.length || r.startBad.length || !(r.maxOrders >= 1)) fails.push([p.id, r.fails, r.startBad]);
    // 링으로 돌릴 때 다른 조각 위로 올라타거나(1) 판 밖에서 판 칸으로 들어가거나(3) 떠 있는 조각(6)이 없다
    for (const v of ['rotateFirst', 'moveFirst']) {
      const h = r.hops[v];
      if (h[1] || h[3] || h[6]) fails.push([p.id, v, h]);
    }
  }
  assert.deepEqual(fails, []);
});

test('D clues match 3D target and on-screen convention', () => {
  const conv = staticConventions();
  assert.ok(conv.viewsLayoutOk, conv.viewsAreas);
  assert.ok(conv.labelAtFront);
  const bad = bank.map((p) => [p.id, checkClues(p)]).filter(([, b]) => b.length);
  assert.deepEqual(bad, []);
});

test('E level-4 alternatives buildable from pieces are accepted by judge', () => {
  const rej = bank.filter((p) => p.stage === 4).map(level4Alternatives).filter((e) => e.rejected.length || e.buildable < 1);
  assert.deepEqual(rej, []);
});

// 감사 도구가 실제 결함을 잡는지(검사기 자체 검사)
test('self-check: flipped clue and wrong placement are detected', () => {
  const t = [[0, 0, 0], [1, 0, 0], [0, 0, 1], [0, 1, 0]];
  const exp = expectedScreenClues(t);
  const flipped = clueFor(t, 2).counts.slice().reverse();
  assert.notDeepEqual(flipped, exp.counts);
  assert.deepEqual(renderedClue(t, 2).counts, exp.counts);
  assert.deepEqual(exp.side, [[false, true], [true, true]]);
  const p = bank[0];
  const sol = solutionsOf(p)[0];
  const order = validOrders(sol)[0];
  const bogus = sol.map((s, i) => (i === order[0] ? { cells: s.cells, pos: [s.pos[0] + 1, s.pos[1], s.pos[2]] } : s));
  assert.equal(playOrder(p, bogus, order, startState(p, 1)).ok, false);
  assert.equal(playOrder(p, sol, order, startState(p, 1)).ok, true);
});
