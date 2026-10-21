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
import { avoidColumns } from './scene/avoid.js';
import { createRenderer, createFpsMeter } from './scene/perf.js';
import { attachInput } from './scene/input.js';
import {
  initScreens, showScreen, currentScreen, openTutorial, onStart, onTutorialDone, onNext,
  showWin, setTitleStats, detectInputKind, showWebGLError, onPortrait,
} from './ui/screens.js';
import { renderHud, showBubble, hideBubble, setEasyAvailable, onTool, levelName } from './ui/hud.js';
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
    const p = fetch(`data/puzzles-s${stage}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`문제 은행 ${stage}단계를 받지 못함(${r.status})`);
        return r.json();
      })
      .then((list) => {
        if (!Array.isArray(list) || list.length === 0) throw new Error(`문제 은행 ${stage}단계가 비어 있음`);
        return list;
      });
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
let pausedAt = null; // 멈춘 시각(도움말·세로 화면 안내가 떠 있는 동안 경과 시간을 멈춘다)
const pauseReasons = new Set(); // 'help' | 'portrait'
let loadFailed = false; // 문제 은행을 받지 못해 새 문제를 못 냈다
let solved = false;
let started = false; // 게임에 한 번이라도 들어갔는지
let shakes = 0; // 확인용: 흔들기 횟수
let loading = Promise.resolve();

const nowOrPaused = () => pausedAt ?? performance.now();
const elapsedSec = () => (nowOrPaused() - startAt) / 1000;
function pauseTimer(reason = 'help') {
  pauseReasons.add(reason);
  if (pausedAt === null) pausedAt = performance.now();
}
function resumeTimer(reason = 'help') {
  pauseReasons.delete(reason);
  if (pausedAt === null || pauseReasons.size) return;
  startAt += performance.now() - pausedAt;
  pausedAt = null;
}

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
let meter = null; // 그린 프레임만 재는 fps 측정기(게임에 처음 들어갈 때 만든다)
let renders = 0; // 확인용: 실제로 그린 프레임 수

if (renderer) {
  const scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(22, 16 / 10, 0.1, 500);
  world = createWorld(renderer, scene, camera);
  const fit = () => {
    const r = stage.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    renderer.setSize(r.width, r.height, false);
    fitCamera(camera, r.width, r.height);
    world.invalidate();
  };
  new ResizeObserver(fit).observe(stage);
  fit();
  input = attachInput({
    canvas, stage, world,
    getPieces: () => pieces,
    setPiece: (i, p) => { if (pieces[i]) pieces[i] = { ...p, color: pieces[i].color }; },
    onDrop: () => check(),
    onRotate: () => check(),
  });
  // 게임 화면이 보일 때(도움말이 위에 겹친 때 포함)만, 바뀐 것이 있을 때만 그린다(world.frame).
  // fps 는 게임 화면에서 움직임을 그린 프레임만 잰다. 겹친 화면(도움말의 흐림 효과)이 있으면 재지 않는다.
  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!stage.classList.contains('on')) { meter?.gap(); return; }
    const kind = world.frame(dt);
    if (kind) renders += 1;
    if (kind === 'motion' && currentScreen() === 'game') meter?.frame(now);
    else meter?.gap();
  });
  // GPU 가 화면을 잃으면(절전·드라이버 재시작 등) 다시 불러오라고 안내한다.
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    input?.cancel();
    const card = $('#glLost');
    if (card) {
      card.hidden = false;
      card.querySelector('button')?.focus({ preventScroll: true });
    }
  });
  $('#glLost button')?.addEventListener('click', () => location.reload());
} else {
  showWebGLError();
}

// 조각이 가려지면 안 되는 화면 UI. 위쪽 칩·미션·섬 배지는 작업대 바깥이라 단서 카드만 본다.
// 게임 화면이 보일 때만 잰다(숨겨져 있으면 크기가 0이라 건너뛴다).
// 쉬운 단서 버튼은 문제 도중에 나타나 카드를 길게 만들므로, 숨겨져 있으면 잠깐 보이게 해 그 높이까지 잰다.
const UI_SELECTORS = ['#clueCard'];
function measureWithEasy(el) {
  const easy = $('#easyBtn');
  if (!easy || !easy.hidden || !el.contains(easy)) return el.getBoundingClientRect();
  easy.hidden = false;
  const r = el.getBoundingClientRect();
  easy.hidden = true;
  return r;
}
function uiRects() {
  const base = stage.getBoundingClientRect();
  const out = [];
  for (const sel of UI_SELECTORS) {
    const el = $(sel);
    if (!el || el.hidden) continue;
    const r = measureWithEasy(el);
    if (r.width < 2 || r.height < 2) continue;
    out.push({ l: r.left - base.left, t: r.top - base.top, r: r.right - base.left, b: r.bottom - base.top });
  }
  return out;
}

// 시작 배치: 각 조각을 눕혀 판 둘레에 두고 위에서 떨어뜨린다. 단서 카드 등에 가려지는 칸은 피한다.
function startPieces(p) {
  const fp = footprint(p.target);
  const base = stage.getBoundingClientRect();
  // 높이 1칸·여유 0으로 잰다. 더 넉넉하게(2칸·10px) 잡으면 1단계에서 오른쪽 조각이 뒤로 밀려 목표 모양에 겹친다.
  const avoid = camera && base.width > 1
    ? avoidColumns(camera, uiRects(), boardCenter(fp), { W: base.width, H: base.height, maxH: 1, margin: 0 })
    : null;
  const starts = placeStarts(p.pieces, fp, Math.random, undefined, avoid);
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
  // 새 단서 카드를 먼저 그려 크기를 맞춘 뒤 카드에 가려지지 않는 자리를 고른다.
  renderClue($('#clueCard'), clueFor(p.target, progress.stage));
  let nextPieces;
  try {
    nextPieces = startPieces(p); // 배치가 안 되면 여기서 던지고 지금 문제는 그대로 둔다
  } catch (err) {
    if (puzzle) showClue(); // 미리 그린 새 카드를 지금 문제의 카드로 되돌린다
    throw err;
  }
  input?.cancel(); // 끌던 조각·열린 링을 버린다
  puzzle = { id: p.id, target: p.target, pieces: p.pieces };
  pieces = nextPieces;
  level = progress.stage;
  usedEasy = false;
  solved = false;
  attemptNo += 1;
  attemptId = `${puzzle.id}#${attemptNo}`;
  startAt = nowOrPaused();
  remember(puzzle.id);
  hideBubble();
  world?.stopShake();
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
// 은행을 받지 못하면 "문제를 불러오지 못했어요" 카드를 띄운다(다시 불러오기·건너뛰기로 다시 시도).
function nextPuzzle() {
  loading = (async () => {
    try {
      for (let n = 0; n < 5; n++) {
        const p = await pickPuzzle(progress.stage);
        try {
          begin(p);
          setLoadFailed(false);
          return;
        } catch (err) {
          console.warn('문제를 시작할 수 없어 다른 문제를 고릅니다', p.id, err);
          remember(p.id);
        }
      }
      throw new Error('시작 배치가 되는 문제를 찾지 못함');
    } catch (err) {
      console.warn('문제를 불러오지 못했습니다', err);
      setLoadFailed(true);
    }
  })();
  return loading;
}

function setLoadFailed(on) {
  loadFailed = on;
  const card = $('#loadFail');
  if (card) card.hidden = !on;
  if (on) setEasyAvailable(false);
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
    ? `다음: ${levelName(progress.stage)}`
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
  if (!puzzle || solved || usedEasy || loadFailed || pausedAt !== null) return;
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
  // 문제를 못 불러온 상태면 연속 기록은 그대로 두고 다시 불러오기만 한다.
  if (!puzzle || loadFailed) {
    nextPuzzle();
    return;
  }
  progress = recordSkip(progress);
  persist();
  nextPuzzle();
}

function restart() {
  if (!puzzle || solved) return;
  let next;
  try {
    next = startPieces(puzzle); // begin() 처럼: 배치가 안 되면 지금 배치를 그대로 둔다
  } catch (err) {
    console.warn('다시 놓을 자리를 찾지 못해 그대로 둡니다', puzzle.id, err);
    return;
  }
  input?.cancel();
  pieces = next;
  world?.setPieces(pieces);
}

// ---------- 화면 흐름 ----------
function enterGame() {
  showScreen('game');
  if (started) return;
  started = true;
  if (renderer) meter = createFpsMeter(renderer, world);
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
  if (mode === 'help') {
    resumeTimer('help');
    showScreen('game');
  } else enterGame();
});
onNext(() => {
  if (currentScreen() !== 'win') return; // 두 번 눌러도 한 번만
  showScreen('game');
  nextPuzzle();
});
onTool('help', () => {
  input?.cancel();
  pauseTimer('help'); // 도움말을 보는 동안 시간은 멈춘다
  openTutorial({ inputKind: detectInputKind(), mode: 'help' });
});
onTool('retry', () => nextPuzzle());
// 세로 화면 안내가 떠 있는 동안은 풀 수 없으니 시간도 멈춘다.
onPortrait((on) => (on ? pauseTimer('portrait') : resumeTimer('portrait')));
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
      paused: pausedAt !== null, pauseReasons: [...pauseReasons], loadFailed, lowMode: meter?.done ?? false, renders,
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
    // 판 좌표 점의 화면(클라이언트) 좌표
    project(x, y, z) {
      if (!world) return null;
      v.copy(world.toWorld(x, y, z)).project(camera);
      const r = canvas.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
    },
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
    uiRects,
    // id(은행 문제) 또는 {id, target, pieces} 고정 문제로 바꾼다.
    async setPuzzle(idOrProto) {
      await loading;
      const p = typeof idOrProto === 'string' ? await findPuzzle(idOrProto) : idOrProto;
      begin(p);
      return puzzle.id;
    },
    elapsed(sec) {
      startAt = nowOrPaused() - sec * 1000;
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
