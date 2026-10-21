// 게임 흐름: 시작 → (첫 접속이면) 조작 안내 → 게임 ↔ 정답 → 다음 문제.
// 문제 은행(data/puzzles-s{단계}.json)에서 무작위로 고르고(최근 10개 제외), 시작 배치·3D 장면·입력·판정·점수·저장을 잇는다.
// ?e2e 이면 시험 훅 window.__ckUi(화면 UI, tests/e2e/ui_test.py)와 window.__ck(게임 흐름, tests/e2e/flow_test.py)를 연다.
import * as THREE from '#three';
import { clueFor, footprint } from './core/clues.js';
import { judge } from './core/judge.js';
import { solve } from './core/solver.js';
import { dropY, occupiedSet } from './core/board.js';
import { boardCenter, placeStarts, fits } from './core/layout.js';
import {
  createProgress, recordSolve, recordSkip, canUseEasy, easyLevel,
  islandStage, toNextIsland, multiplier,
} from './core/progress.js';
import { load, save } from './core/storage.js';
import { fitCamera } from './scene/calibrate.js';
import { createWorld } from './scene/world.js';
import { createRenderer, watchFps } from './scene/perf.js';
import { attachInput } from './scene/input.js';
import {
  initScreens, showScreen, currentScreen, openTutorial, onStart, onTutorialDone, onNext,
  showWin, setTitleStats, detectInputKind, showWebGLError,
} from './ui/screens.js';
import { renderHud, showBubble, setEasyAvailable, onTool, levelName } from './ui/hud.js';
import { renderClue } from './ui/clueCard.js';

const COLORS = ['#3B9BFF', '#3DD47A', '#FF8A2B', '#A86BFF', '#FFD23F'];
const RECENT_MAX = 10; // 최근에 낸 문제는 이만큼 피한다
const MISMATCH_TEXT = '모양이 조금 달라요';
const qs = new URLSearchParams(location.search);
const E2E = qs.has('e2e');
const $ = (sel) => document.querySelector(sel);

// ---------- 문제 은행 ----------
const banks = new Map();
function bank(stage) {
  if (!banks.has(stage)) {
    const p = fetch(`data/puzzles-s${stage}.json`).then((r) => r.json());
    p.catch(() => banks.delete(stage)); // 실패하면 다음에 다시 받는다
    banks.set(stage, p);
  }
  return banks.get(stage);
}
const stageOfId = (id) => Number((/^s([1-4])-/.exec(id) || [0, '1'])[1]);
async function findPuzzle(id) {
  const list = await bank(stageOfId(id));
  return list.find((p) => p.id === id) ?? list[0];
}

const recent = [];
async function pickPuzzle(stage) {
  const list = await bank(stage);
  const fresh = list.filter((p) => !recent.includes(p.id));
  const pool = fresh.length ? fresh : list;
  return pool[Math.floor(Math.random() * pool.length)];
}
function remember(id) {
  const i = recent.indexOf(id);
  if (i >= 0) recent.splice(i, 1);
  recent.push(id);
  while (recent.length > RECENT_MAX) recent.shift();
}

// ---------- 상태 ----------
let progress = createProgress({ solvedTotal: load('solvedTotal', 0), best: load('best', 0) });
let puzzle = null; // {id, target, pieces}
let pieces = []; // [{cells, pos:[x,y,z], color}]
let level = 1; // 지금 보이는 단서 단계(쉬운 단서면 stage − 1)
let usedEasy = false;
let attemptNo = 0;
let attemptId = '';
let startAt = 0; // performance.now() 기준 문제 시작 시각
let solved = false;
let started = false; // 게임에 한 번이라도 들어갔는지
let shakes = 0; // 확인용: 흔들기 횟수
let loading = Promise.resolve();

const elapsedSec = () => (performance.now() - startAt) / 1000;

function hud() {
  renderHud({
    stage: progress.stage, levelName: levelName(progress.stage), streak: progress.streak,
    mult: multiplier(progress.streak), score: progress.score,
    island: islandStage(progress.solvedTotal), toNext: toNextIsland(progress.solvedTotal),
  });
}

function persist() {
  save('best', progress.best);
  save('solvedTotal', progress.solvedTotal);
  setTitleStats({ best: progress.best, island: islandStage(progress.solvedTotal) });
}

// ---------- 3D ----------
const stage = $('#screen-game');
const canvas = $('#c');
const renderer = createRenderer(canvas);
let world = null;
let input = null;
let camera = null;

if (renderer) {
  const scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(22, 16 / 10, 0.1, 500);
  world = createWorld(renderer, scene, camera);
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    renderer.setSize(r.width, r.height, false);
    fitCamera(camera, r.width, r.height);
  };
  new ResizeObserver(fit).observe(stage);
  fit();
  input = attachInput({
    canvas, stage, world,
    getPieces: () => pieces,
    setPiece: (i, p) => { pieces[i] = { ...p, color: pieces[i].color }; },
    onDrop: () => check(),
    onRotate: () => check(),
  });
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const scr = currentScreen();
    if (scr === 'game' || scr === 'tutorial') world.frame(dt);
  });
} else {
  showWebGLError();
}

// 시작 배치: 각 조각을 눕혀 판 둘레에 두고 위에서 떨어뜨린다.
function startPieces(p) {
  const fp = footprint(p.target);
  const starts = placeStarts(p.pieces, fp, Math.random);
  const out = [];
  starts.forEach((s, i) => {
    const y = dropY(s.cells, s.x, s.z, occupiedSet(out, -1));
    out.push({ cells: s.cells, pos: [s.x, y, s.z], color: COLORS[i % COLORS.length] });
  });
  return out;
}

function showClue() {
  renderClue($('#clueCard'), clueFor(puzzle.target, level), { easy: usedEasy });
  world?.showGhost(level === 1);
}

function begin(p) {
  puzzle = { id: p.id, target: p.target, pieces: p.pieces };
  pieces = startPieces(puzzle);
  level = progress.stage;
  usedEasy = false;
  solved = false;
  attemptNo += 1;
  attemptId = `${puzzle.id}#${attemptNo}`;
  startAt = performance.now();
  remember(puzzle.id);
  if (world) {
    world.setPuzzle(puzzle.target);
    world.setPieces(pieces);
    input.resetSpin();
  }
  showClue();
  setEasyAvailable(false);
  hud();
}

// 현재 단계 은행에서 새 문제. 시작 배치가 안 되는 문제는 건너뛴다.
function nextPuzzle() {
  loading = (async () => {
    for (let n = 0; n < 5; n++) {
      const p = await pickPuzzle(progress.stage);
      try {
        begin(p);
        return;
      } catch (err) {
        console.warn('문제를 시작할 수 없어 다른 문제를 고릅니다', p.id, err);
        remember(p.id);
      }
    }
  })();
  return loading;
}

// ---------- 판정·정답 ----------
// 끌기를 놓은 뒤·돌린 뒤에만 부른다(끄는 중에는 부르지 않는다).
function check() {
  if (!puzzle || solved || currentScreen() !== 'game') return;
  const r = judge(pieces, puzzle.target, level);
  if (r === 'solved') win();
  else if (r === 'mismatch') {
    world?.shakeBoard();
    shakes += 1;
    showBubble(MISMATCH_TEXT);
  }
}

function win() {
  solved = true;
  setEasyAvailable(false);
  const seconds = elapsedSec();
  const before = progress;
  const res = recordSolve(progress, { puzzleId: attemptId, seconds, usedEasy });
  if (res.gained === 0) return; // 같은 시도를 두 번 판정(점수는 한 번만)
  progress = res.state;
  persist();
  const islandBefore = islandStage(before.solvedTotal);
  const islandAfter = islandStage(progress.solvedTotal);
  const toNext = toNextIsland(progress.solvedTotal);
  const nextHint = res.promoted
    ? `다음: ${levelName(progress.stage)} 단서`
    : (toNext == null ? '가장 큰 섬을 지었어요' : `다음 단계까지 ${toNext}문제`);
  showWin({
    gained: res.gained, base: 100, speed: Math.max(0, 60 - Math.floor(seconds)),
    streak: progress.streak, mult: multiplier(progress.streak), usedEasy,
    islandBefore, islandAfter, nextHint,
  });
  hud();
}

// 1초마다 경과 시간을 보고 쉬운 단서 버튼을 띄운다.
function tick() {
  if (!puzzle || solved || usedEasy) return;
  setEasyAvailable(canUseEasy(progress.stage, elapsedSec()));
}
setInterval(tick, 1000);

function useEasy() {
  if (!puzzle || solved || usedEasy || !canUseEasy(progress.stage, elapsedSec())) return;
  usedEasy = true;
  level = easyLevel(progress.stage);
  setEasyAvailable(false);
  showClue();
}

function skip() {
  if (!puzzle) return;
  progress = recordSkip(progress);
  persist();
  nextPuzzle();
}

function restart() {
  if (!puzzle || solved) return;
  pieces = startPieces(puzzle);
  world?.setPieces(pieces);
}

// ---------- 화면 흐름 ----------
function enterGame() {
  showScreen('game');
  if (started) return;
  started = true;
  if (renderer) watchFps(renderer, world);
  nextPuzzle();
}

initScreens();
hud();
setTitleStats({ best: progress.best, island: islandStage(progress.solvedTotal) });

onStart(() => {
  if (load('tutorialSeen', false)) enterGame();
  else openTutorial({ inputKind: detectInputKind(), mode: 'start' });
});
onTutorialDone(({ dontShowAgain, mode }) => {
  if (dontShowAgain) save('tutorialSeen', true);
  // 도움말로 연 안내는 닫기만 한다(같은 문제·같은 배치로 돌아간다).
  if (mode === 'help') showScreen('game');
  else enterGame();
});
onNext(() => {
  showScreen('game');
  nextPuzzle();
});
onTool('help', () => openTutorial({ inputKind: detectInputKind(), mode: 'help' }));
onTool('easy', useEasy);
onTool('skip', skip);
onTool('restart', restart);
onTool('reset', () => input?.resetSpin());

// ---------- 시험 훅 ----------
if (E2E) {
  // 단서 카드만 그린다(게임 상태는 바꾸지 않는다).
  const showPuzzle = async (id, lvl, opts) => {
    const p = await findPuzzle(id);
    renderClue($('#clueCard'), clueFor(p.target, lvl), opts);
    return p.id;
  };
  window.__ckUi = { showScreen, showWin, renderHud, showBubble, setEasyAvailable, showPuzzle, openTutorial };

  const v = renderer ? new THREE.Vector3() : null;
  const copy = (list) => list.map((p) => ({ cells: p.cells.map((c) => [...c]), pos: [...p.pos], color: p.color }));
  // 조각을 한꺼번에 바꾸고 놓은 뒤처럼 판정한다.
  const placeAll = (list) => {
    list.forEach((s, i) => {
      pieces[i] = { cells: s.cells.map((c) => [...c]), pos: [...s.pos], color: pieces[i].color };
      world?.updatePiece(i, pieces[i]);
    });
    check();
  };
  window.__ck = {
    state: () => ({
      screen: currentScreen(), stage: progress.stage, streak: progress.streak, score: progress.score,
      solvedTotal: progress.solvedTotal, best: progress.best, level, usedEasy, solved,
      puzzleId: puzzle?.id ?? null, attemptId, elapsed: puzzle ? elapsedSec() : 0, shakes, webgl: !!renderer,
    }),
    puzzle: () => (puzzle ? JSON.parse(JSON.stringify(puzzle)) : null),
    pieces: () => copy(pieces),
    pieceScreenXY(i) {
      if (!world) return null;
      const p = pieces[i];
      const n = p.cells.length;
      const m = [0, 1, 2].map((k) => p.cells.reduce((s, c) => s + c[k], 0) / n);
      const c = p.cells.reduce((best, q) => (Math.hypot(q[0] - m[0], q[1] - m[1], q[2] - m[2])
        < Math.hypot(best[0] - m[0], best[1] - m[1], best[2] - m[2]) ? q : best));
      v.copy(world.toWorld(p.pos[0] + c[0] + 0.5, p.pos[1] + c[1] + 0.5, p.pos[2] + c[2] + 0.5)).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
    fits: (i) => fits(pieces[i].cells, pieces[i].pos[0], pieces[i].pos[2], boardCenter(footprint(puzzle.target))),
    spin: () => world?.getSpin() ?? 0,
    setSpin: (r) => world?.setSpin(r),
    ghostVisible: () => level === 1,
    // 해답 탐색기의 첫 해답으로 조각을 옮기고 판정한다.
    solveCurrent() {
      const sol = solve(puzzle.target, puzzle.pieces, { limit: 1 }).solutions[0];
      if (sol) placeAll(sol);
      return !!sol;
    },
    placeAll,
    // id(은행 문제) 또는 {id, target, pieces} 고정 문제로 바꾼다.
    async setPuzzle(idOrProto) {
      await loading;
      const p = typeof idOrProto === 'string' ? await findPuzzle(idOrProto) : idOrProto;
      begin(p);
      return puzzle.id;
    },
    elapsed(sec) {
      startAt = performance.now() - sec * 1000;
      tick();
    },
    setProgress(patch) {
      progress = { ...progress, ...patch };
      hud();
    },
    world,
    input,
  };
}
window.__ckReady = true;
