// 임시 부트스트랩(Task 8): 화면 UI만 연결한다. 3D·게임 흐름은 Task 9에서 이 파일을 새로 쓴다.
// ?e2e 이면 window.__ckUi 시험 훅을 연다(tests/e2e/ui_test.py). Task 9도 이 훅을 유지해야 한다.
import { clueFor } from './core/clues.js';
import { createProgress, islandStage, toNextIsland, multiplier } from './core/progress.js';
import { load, save } from './core/storage.js';
import { initScreens, showScreen, openTutorial, onStart, onTutorialDone, onNext, showWin, setTitleStats, detectInputKind } from './ui/screens.js';
import { renderHud, showBubble, setEasyAvailable, onTool, levelName } from './ui/hud.js';
import { renderClue } from './ui/clueCard.js';

const qs = new URLSearchParams(location.search);
const banks = new Map();

async function bank(stage) {
  if (!banks.has(stage)) banks.set(stage, fetch(`data/puzzles-s${stage}.json`).then((r) => r.json()));
  return banks.get(stage);
}

async function findPuzzle(id) {
  const stage = Number((/^s([1-4])-/.exec(id) || [0, '1'])[1]);
  const list = await bank(stage);
  return list.find((p) => p.id === id) ?? list[0];
}

let progress = createProgress({ solvedTotal: load('solvedTotal', 0), best: load('best', 0) });

function hudFromProgress(p) {
  renderHud({
    stage: p.stage, levelName: levelName(p.stage), streak: p.streak, mult: multiplier(p.streak), score: p.score,
    island: islandStage(p.solvedTotal), toNext: toNextIsland(p.solvedTotal),
  });
}

async function showPuzzle(id, level, opts) {
  const puzzle = await findPuzzle(id);
  renderClue(document.querySelector('#clueCard'), clueFor(puzzle.target, level), opts);
  return puzzle.id;
}

async function enterGame() {
  setEasyAvailable(false);
  hudFromProgress(progress);
  await showPuzzle(`s${progress.stage}-001`, progress.stage);
  showScreen('game');
}

initScreens();
setTitleStats({ best: progress.best, island: islandStage(progress.solvedTotal) });

onStart(() => {
  if (load('tutorialSeen', false)) enterGame();
  else openTutorial({ inputKind: detectInputKind(), mode: 'start' });
});
onTutorialDone(({ dontShowAgain }) => {
  if (dontShowAgain) save('tutorialSeen', true);
  enterGame();
});
onNext(() => enterGame());
onTool('help', () => openTutorial({ inputKind: detectInputKind(), mode: 'help' }));

if (qs.has('e2e')) {
  window.__ckUi = { showScreen, showWin, renderHud, showBubble, setEasyAvailable, showPuzzle, openTutorial };
}
window.__ckReady = true;
