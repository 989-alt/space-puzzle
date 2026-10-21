// 화면 전환(시작·안내·게임·정답)과 세로 화면 안내. 그리기와 콜백만 둔다(게임 규칙·저장 금지).
import { ISLAND_NAMES } from './hud.js';

const $ = (sel) => document.querySelector(sel);
const SCREENS = ['title', 'tutorial', 'game', 'win'];

// 안내 카드 문구. 강조(em)는 문구 안의 낱말만 감싸며 글자는 바꾸지 않는다.
const TIPS = {
  touch: {
    head2: '톡 누르면 돌려요',
    tips: [
      ['조각을 손가락으로 끌어 ', ['판 위'], '에 내려놓아요.'],
      ['조각을 톡 누르면 ', ['돌리기·세우기·뒤집기'], ' 버튼이 나와요.'],
      [['빈 곳'], '을 끌면 판이 돌아가요. ', ['두 손가락'], '으로도 돌릴 수 있어요.'],
    ],
  },
  mouse: {
    head2: '클릭하면 돌려요',
    tips: [
      ['조각을 마우스 왼쪽 버튼으로 끌어 ', ['판 위'], '에 놓아요.'],
      ['조각을 클릭하면 ', ['돌리기·세우기·뒤집기'], ' 버튼이 나와요.'],
      [['빈 곳'], '을 끌면 판이 돌아가요.'],
    ],
  },
};

const handlers = { start: [], tutorialDone: [], next: [] };
let current = 'title';
let tutorialReturn = 'game';
let inited = false;

export function detectInputKind() {
  try {
    return globalThis.matchMedia?.('(pointer: coarse)').matches ? 'touch' : 'mouse';
  } catch {
    return 'mouse';
  }
}

const reducedMotion = () => {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
};

export function showScreen(name) {
  if (!SCREENS.includes(name)) throw new Error(`unknown screen: ${name}`);
  current = name;
  for (const s of SCREENS) {
    const el = $(`#screen-${s}`);
    if (!el) continue;
    // 안내는 게임 위에 겹쳐 띄울 수 있도록 게임 화면을 끄지 않는다.
    const on = s === name || (name === 'tutorial' && s === 'game' && tutorialReturn === 'game' && el.classList.contains('on'));
    el.classList.toggle('on', on);
    el.inert = !on || (name === 'tutorial' && s === 'game');
  }
  if (name !== 'win') clearConfetti();
}

export function currentScreen() {
  return current;
}

function setTutorialKind(kind) {
  const set = TIPS[kind] ? kind : 'mouse';
  document.querySelectorAll('#screen-tutorial .seg button').forEach((b) => {
    b.setAttribute('aria-pressed', String(b.dataset.kind === set));
  });
  const hd = $('#screen-tutorial [data-hd="1"]');
  if (hd) hd.replaceChildren(Object.assign(document.createElement('b'), { textContent: '2.' }), ` ${TIPS[set].head2}`);
  TIPS[set].tips.forEach((parts, i) => {
    const p = $(`#screen-tutorial [data-tip="${i}"]`);
    if (!p) return;
    const span = document.createElement('span');
    span.append(...parts.map((x) => (Array.isArray(x) ? Object.assign(document.createElement('em'), { textContent: x[0] }) : x)));
    p.replaceChildren(span);
  });
}

// mode 'start': 시작 버튼 다음(끝나면 게임으로), 'help': 게임 중 도움말(끝나면 게임으로 돌아감)
export function openTutorial({ inputKind = detectInputKind(), mode = 'start' } = {}) {
  tutorialReturn = mode === 'help' ? 'game' : 'start';
  setTutorialKind(inputKind);
  $('#screen-tutorial')?.classList.toggle('over-game', mode === 'help');
  const done = $('#tutDone');
  if (done) done.lastChild.textContent = mode === 'help' ? '알겠어요, 계속!' : '알겠어요, 시작!';
  showScreen('tutorial');
}

export function onStart(cb) { handlers.start.push(cb); }
// cb({ dontShowAgain, mode })
export function onTutorialDone(cb) { handlers.tutorialDone.push(cb); }
export function onNext(cb) { handlers.next.push(cb); }

export function setTitleStats({ best = 0, island = 0 } = {}) {
  const t = $('#bestText');
  if (t) t.textContent = `내 최고 기록 ${Number(best).toLocaleString('ko-KR')}점 · 섬 ${island + 1}단계`;
}

export function showWebGLError() {
  const el = $('#glFail');
  if (el) el.hidden = false;
}

function chip(text, cls) {
  const s = document.createElement('span');
  if (cls) s.className = cls;
  s.textContent = text;
  return s;
}

function islandImg(stage) {
  const img = document.createElement('img');
  img.src = `assets/img/island-${stage + 1}.png`;
  img.alt = ISLAND_NAMES[stage] ?? '';
  return img;
}

const fmtMult = (m) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;

export function showWin({ gained = 0, base = 100, speed = 0, streak = 0, mult = 1, usedEasy = false,
  islandBefore = 0, islandAfter = 0, nextHint = '' } = {}) {
  $('#winGain').textContent = `+${Number(gained).toLocaleString('ko-KR')}`;
  const calc = $('#winCalc');
  const parts = [chip(`기본 ${base}`), chip(`빠르기 +${speed}`)];
  if (streak > 0) parts.push(chip(`${streak}연속 ${fmtMult(mult)}`, mult > 1 ? 'x' : ''));
  if (usedEasy) parts.push(chip('쉬운 단서 ×0.5', 'h'));
  calc.replaceChildren(...parts);

  const grow = $('#winGrow');
  const p = document.createElement('p');
  const b = document.createElement('b');
  b.textContent = ISLAND_NAMES[islandAfter] ?? '';
  if (islandAfter > islandBefore) {
    const arr = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    arr.setAttribute('class', 'arr');
    arr.innerHTML = '<use href="#i-chev"/>';
    p.append('섬이 자랐어요!', b, nextHint);
    grow.replaceChildren(islandImg(islandBefore), arr, islandImg(islandAfter), p);
  } else {
    p.append('내 섬', b, nextHint);
    grow.replaceChildren(islandImg(islandAfter), p);
  }
  showScreen('win');
  spawnConfetti();
}

function clearConfetti() {
  $('#conf')?.replaceChildren();
}

function spawnConfetti() {
  const conf = $('#conf');
  if (!conf) return;
  conf.replaceChildren();
  if (reducedMotion()) return;
  const colors = ['#5EE1FF', '#FFE27A', '#FF8A3D', '#B98CFF', '#7CF39B'];
  for (let i = 0; i < 46; i++) {
    const d = document.createElement('div');
    d.className = 'conf';
    d.style.left = `${2 + Math.random() * 96}%`;
    d.style.background = colors[i % colors.length];
    d.style.setProperty('--r0', `${Math.round(Math.random() * 180)}deg`);
    d.style.animationDuration = `${3 + Math.random() * 3}s`;
    d.style.animationDelay = `${-Math.random() * 6}s`;
    conf.append(d);
  }
}

function watchPortrait() {
  const hint = $('#rotateHint');
  if (!hint || !globalThis.matchMedia) return;
  const mq = matchMedia('(orientation: portrait)');
  const apply = () => { hint.hidden = !mq.matches; };
  apply();
  mq.addEventListener?.('change', apply);
}

export function initScreens() {
  if (inited) return;
  inited = true;
  $('#startBtn')?.addEventListener('click', () => handlers.start.forEach((cb) => cb()));
  $('#howBtn')?.addEventListener('click', () => openTutorial({ mode: 'start' }));
  document.querySelectorAll('#screen-tutorial .seg button').forEach((b) => {
    b.addEventListener('click', () => setTutorialKind(b.dataset.kind));
  });
  $('#tutDone')?.addEventListener('click', () => {
    const dontShowAgain = $('#dontShow')?.checked === true;
    const mode = tutorialReturn === 'game' ? 'help' : 'start';
    handlers.tutorialDone.forEach((cb) => cb({ dontShowAgain, mode }));
  });
  $('#nextBtn')?.addEventListener('click', () => handlers.next.forEach((cb) => cb()));
  watchPortrait();
}
