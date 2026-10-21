import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProgress, multiplier, scoreFor, recordSolve, recordSkip,
  islandStage, toNextIsland, canUseEasy, easyLevel,
} from '../src/core/progress.js';

test('multiplier table', () => assert.deepEqual([1, 2, 3, 4, 5, 6, 9].map(multiplier), [1, 1, 1.5, 2, 2, 3, 3]));
test('score fast 4th streak', () => assert.equal(scoreFor(26, 4, false), 268));
test('score with easy hint halves', () => assert.equal(scoreFor(70, 1, true), 50));
test('score floors seconds then rounds', () => {
  assert.equal(scoreFor(26.9, 4, false), 268);
  assert.equal(scoreFor(0, 3, true), Math.round(160 * 1.5 * 0.5));
});
test('createProgress defaults and saved', () => {
  assert.deepEqual(createProgress(), { stage: 1, streak: 0, promo: 0, score: 0, solvedTotal: 0, best: 0, lastSolvedId: null });
  const s = createProgress({ solvedTotal: 7, best: 900 });
  assert.equal(s.solvedTotal, 7);
  assert.equal(s.best, 900);
});
test('two clean solves promote', () => {
  let s = createProgress();
  s = recordSolve(s, { puzzleId: 'a', seconds: 10 }).state;
  const r = recordSolve(s, { puzzleId: 'b', seconds: 10 });
  assert.equal(r.promoted, true);
  assert.equal(r.state.stage, 2);
  assert.equal(r.state.promo, 0);
});
test('easy solve keeps streak but resets promo', () => {
  let s = createProgress();
  s = recordSolve(s, { puzzleId: 'a', seconds: 10 }).state;
  assert.equal(s.promo, 1);
  const r = recordSolve(s, { puzzleId: 'b', seconds: 70, usedEasy: true });
  assert.equal(r.state.streak, 2);
  assert.equal(r.state.promo, 0);
  assert.equal(r.promoted, false);
  assert.equal(r.state.stage, 1);
});
test('skip lowers streak by one, not below 0, stage unchanged', () => {
  let s = { ...createProgress(), streak: 3, promo: 1, stage: 2, lastSolvedId: 'q' };
  s = recordSkip(s);
  assert.equal(s.streak, 2);
  assert.equal(s.promo, 0);
  assert.equal(s.stage, 2);
  assert.equal(s.lastSolvedId, 'q');
  assert.equal(recordSkip(recordSkip(recordSkip(s))).streak, 0);
});
test('stage caps at 4', () => {
  let s = { ...createProgress(), stage: 4 };
  s = recordSolve(s, { puzzleId: 'a', seconds: 1 }).state;
  const r = recordSolve(s, { puzzleId: 'b', seconds: 1 });
  assert.equal(r.state.stage, 4);
  assert.equal(r.promoted, false);
});
test('recordSolveIdempotent', () => {
  const s = createProgress();
  const a = recordSolve(s, { puzzleId: 'x', seconds: 5 });
  const b = recordSolve(a.state, { puzzleId: 'x', seconds: 5 });
  assert.equal(b.gained, 0);
  assert.deepEqual(b.state, a.state);
});
test('recordSolve is pure and updates totals', () => {
  const s = createProgress();
  const before = JSON.parse(JSON.stringify(s));
  const r = recordSolve(s, { puzzleId: 'x', seconds: 26 });
  assert.deepEqual(s, before);
  assert.equal(r.gained, 134);
  assert.equal(r.state.score, 134);
  assert.equal(r.state.best, 134);
  assert.equal(r.state.solvedTotal, 1);
  assert.equal(r.state.lastSolvedId, 'x');
});
test('islandUp on 5th solve', () => {
  const s = { ...createProgress(), solvedTotal: 4 };
  const r = recordSolve(s, { puzzleId: 'x', seconds: 5 });
  assert.equal(r.islandUp, true);
  assert.equal(recordSolve(createProgress(), { puzzleId: 'y', seconds: 5 }).islandUp, false);
});
test('island stages every 5 solves', () => assert.deepEqual([0, 4, 5, 14, 15, 99].map(islandStage), [0, 0, 1, 2, 3, 3]));
test('toNextIsland', () => {
  assert.deepEqual([0, 4, 5, 14, 15].map(toNextIsland), [5, 1, 5, 1, null]);
});
test('easy availability', () => {
  assert.equal(canUseEasy(1, 100), false);
  assert.equal(canUseEasy(2, 59), false);
  assert.equal(canUseEasy(2, 60), true);
  assert.equal(easyLevel(3), 2);
});
