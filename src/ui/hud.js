// 게임 화면 HUD: 단계·연속 칩, 점수, 섬 배지, 도구 버튼, 말풍선. 그리기와 콜백만 둔다.
import { toNextIsland } from '../core/progress.js';

const $ = (sel) => document.querySelector(sel);

export const LEVEL_NAMES = ['', '1단계 · 3D 모양', '2단계 · 위에서 본 모양', '3단계 · 층별 단서', '4단계 · 위·앞·옆'];
export const ISLAND_NAMES = ['빈 섬', '블록 오두막', '블록 마을', '블록 성'];
// 섬 한 단계에 필요한 문제 수는 progress.js 규칙에서 가져온다(처음 섬에서 다음 단계까지 남은 수).
const PER_ISLAND = toNextIsland(0);

export const levelName = (level) => LEVEL_NAMES[level] ?? '';
export const fmtMult = (m) => `×${Number.isInteger(m) ? m : m.toFixed(1)}`;

const tools = new Map();
let bubbleTimer = 0;
let wired = false;

// toNext: 다음 섬 단계까지 남은 문제 수, 마지막 단계면 null.
export function renderHud({ stage = 1, levelName: name, streak = 0, mult = 1, score = 0, island = 0, toNext = null } = {}) {
  $('#stageText').textContent = name ?? levelName(stage);
  const combo = $('#comboChip');
  combo.hidden = !(streak > 0);
  $('#comboText').textContent = `${streak}연속 ${fmtMult(mult)}`;
  $('#scoreText').textContent = Number(score).toLocaleString('ko-KR');
  const img = $('#islandImg');
  const src = `assets/img/island-${island + 1}.webp`;
  if (!img.src.endsWith(src)) img.src = src;
  img.alt = `내 섬: ${ISLAND_NAMES[island] ?? ''}`;
  $('#islandName').textContent = ISLAND_NAMES[island] ?? '';
  $('#islandNext').textContent = toNext == null ? '내 섬 · 가장 큰 섬이에요' : `내 섬 · 다음 단계까지 ${toNext}문제`;
  const done = toNext == null ? PER_ISLAND : PER_ISLAND - toNext;
  $('#islandBar').style.width = `${Math.max(0, Math.min(1, done / PER_ISLAND)) * 100}%`;
}

export function showBubble(text, ms = 2500) {
  const b = $('#bubble');
  $('#bubbleText').textContent = text;
  b.classList.add('on');
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => b.classList.remove('on'), ms);
}

export function setEasyAvailable(on) {
  $('#easyBtn').hidden = !on;
}

// name: 'reset' | 'restart' | 'skip' | 'help' | 'easy'
export function onTool(name, cb) {
  if (!tools.has(name)) tools.set(name, []);
  tools.get(name).push(cb);
  if (wired) return;
  wired = true;
  document.querySelector('#screen-game')?.addEventListener('click', (e) => {
    const btn = e.target.closest?.('[data-tool]');
    if (!btn) return;
    (tools.get(btn.dataset.tool) ?? []).forEach((f) => f());
  });
}
