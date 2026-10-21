// 점수·연속·단계·섬 진행. 순수 함수만 둔다(DOM·저장소 금지). 상태는 항상 새 객체로 돌려준다.

export function createProgress(saved) {
  return {
    stage: 1, streak: 0, promo: 0, score: 0,
    solvedTotal: saved?.solvedTotal ?? 0,
    best: saved?.best ?? 0,
    lastSolvedId: null,
  };
}

export function multiplier(streak) {
  if (streak >= 6) return 3;
  if (streak >= 4) return 2;
  if (streak === 3) return 1.5;
  return 1;
}

export function scoreFor(seconds, streakAfter, usedEasy) {
  const speed = Math.max(0, 60 - Math.floor(seconds));
  return Math.round((100 + speed) * multiplier(streakAfter) * (usedEasy ? 0.5 : 1));
}

export function islandStage(solvedTotal) {
  return Math.min(3, Math.floor(solvedTotal / 5));
}

export function toNextIsland(solvedTotal) {
  return islandStage(solvedTotal) >= 3 ? null : 5 - (solvedTotal % 5);
}

export function recordSolve(state, { puzzleId, seconds, usedEasy = false }) {
  if (state.lastSolvedId === puzzleId) {
    return { state: { ...state }, gained: 0, promoted: false, islandUp: false };
  }
  const streak = state.streak + 1;
  const gained = scoreFor(seconds, streak, usedEasy);
  const score = state.score + gained;
  let { stage, promo } = state;
  let promoted = false;
  if (usedEasy) {
    promo = 0;
  } else {
    promo += 1;
    if (promo >= 2 && stage < 4) { stage += 1; promo = 0; promoted = true; }
  }
  const solvedTotal = state.solvedTotal + 1;
  const next = {
    ...state, stage, streak, promo, score, solvedTotal,
    best: Math.max(state.best, score), lastSolvedId: puzzleId,
  };
  return { state: next, gained, promoted, islandUp: islandStage(solvedTotal) > islandStage(state.solvedTotal) };
}

export function recordSkip(state) {
  return { ...state, streak: Math.max(0, state.streak - 1), promo: 0 };
}

export function canUseEasy(stage, elapsedSec) {
  return stage >= 2 && elapsedSec >= 60;
}

export function easyLevel(stage) {
  return stage - 1;
}
