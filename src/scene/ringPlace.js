// 돌리기 링(버튼 3개) 자리 고르기. 순수 함수만 둔다(DOM·three 없이 화면 사각형만 쓴다).
// 링 버튼이 쌓기나무를 덮으면, 그 조각을 누르거나 끌려던 손가락이 버튼을 눌러 고른 조각이 한 번 더 돌아간다
// (2026-10-22 감사 F: 링을 탭한 점에 두면 버튼이 늘 고른 조각을, 26%는 다른 조각까지 덮었다).
// 그래서 링을 고른 조각 둘레에 두되, 버튼이 어떤 쌓기나무의 화면 사각형과도 겹치지 않는 가장 가까운 자리를 고른다.
// 기본 모양(tri: 돌리기 위, 세우기 왼아래, 뒤집기 오른아래)의 가운데 위치와 크기(k)를 바꿔 보고, 조각이 넓어
// 둘러쌀 수 없으면 한 줄 모양(row: 세우기·돌리기·뒤집기를 조각 위나 아래에 가로로)을 쓴다.

export const BTN = 56; // 버튼 지름(px)
export const RING_BUTTONS = [
  { axis: 'y', label: '돌리기', dx: 0, dy: -72 },
  { axis: 'x', label: '세우기', dx: -70, dy: 26 },
  { axis: 'z', label: '뒤집기', dx: 70, dy: 26 },
];
// 한 줄 모양: 왼쪽부터 세우기·돌리기·뒤집기(기본 모양과 왼·오른 순서가 같다), 버튼 사이 80px
const ROW = { y: [0, 0], x: [-80, 0], z: [80, 0] };
export const LABEL_GAP = BTN / 2 + 4; // 버튼 중심에서 글자 위쪽까지
export const LABEL_H = 26;
export const LABEL_HALF_W = 36;
const EDGE = 8; // 화면 가장자리 여유
const PAD = 4; // 버튼과 쌓기나무 사이 여유
const KS = [1, 1.2, 1.4, 1.65, 1.9, 2.2]; // 링 크기 배율 후보(조각이 크면 링을 넓혀 둘레에 둔다)
const STEP = 12;
const SPAN = 144; // 가운데를 고른 조각 가운데에서 이만큼(px)까지 옮겨 본다
const K_COST = 150; // 배율 1 늘릴 때 비용(px 로 환산)
const ROW_SPAN = 264; // 한 줄 모양은 조각 위·아래로 더 멀리 옮겨 본다
const ROW_COST = 90; // 한 줄 모양을 쓸 때 더하는 비용(가능하면 기본 모양)

// 비용이 낮은 순(가까운 자리·작은 링·기본 모양 먼저)으로 정렬한 후보 {dx, dy, k, layout, base}
const CANDS = (() => {
  const out = [];
  for (const k of KS) {
    for (let dx = -SPAN; dx <= SPAN; dx += STEP) {
      for (let dy = -SPAN; dy <= SPAN; dy += STEP) {
        out.push({ dx, dy, k, layout: 'tri', base: Math.hypot(dx, dy) + (k - 1) * K_COST });
      }
    }
  }
  for (let dx = -SPAN; dx <= SPAN; dx += STEP) {
    for (let dy = -ROW_SPAN; dy <= ROW_SPAN; dy += STEP) {
      out.push({ dx, dy, k: 1, layout: 'row', base: Math.hypot(dx, dy) + ROW_COST });
    }
  }
  const L = { tri: 0, row: 1 };
  return out.sort((a, b) => a.base - b.base || L[a.layout] - L[b.layout] || a.k - b.k || a.dy - b.dy || a.dx - b.dx);
})();

// 버튼 하나의 링 가운데 기준 위치(px)
export function buttonOffset(b, { k = 1, layout = 'tri' } = {}) {
  if (layout === 'row') return { dx: ROW[b.axis][0], dy: ROW[b.axis][1] };
  return { dx: b.dx * k, dy: b.dy * k };
}

// 링 {x, y, k, layout} 의 버튼 중심과 글자 사각형(화면 px)
export function ringParts(ring) {
  const { x, y } = ring;
  const buttons = RING_BUTTONS.map((b) => {
    const o = buttonOffset(b, ring);
    return { axis: b.axis, x: x + o.dx, y: y + o.dy };
  });
  const labels = buttons.map((p) => ({
    l: p.x - LABEL_HALF_W, r: p.x + LABEL_HALF_W, t: p.y + LABEL_GAP, b: p.y + LABEL_GAP + LABEL_H,
  }));
  return { buttons, labels };
}

const circleHits = (cx, cy, r, b) => {
  const nx = cx < b.l ? b.l : (cx > b.r ? b.r : cx);
  const ny = cy < b.t ? b.t : (cy > b.b ? b.b : cy);
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
};
const rectHits = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

function fitsScreen({ buttons, labels }, W, H) {
  const r = BTN / 2 + EDGE;
  for (const p of buttons) if (p.x < r || p.x > W - r || p.y < r || p.y > H - r) return false;
  for (const l of labels) if (l.l < EDGE || l.r > W - EDGE || l.t < EDGE || l.b > H - EDGE) return false;
  return true;
}

// 겹침 점수: 다른 조각을 덮는 버튼(가장 나쁨) > 고른 조각을 덮는 버튼 > 쌓기나무를 가리는 글자(누르지는 않음)
function hitScore(parts, boxes, sel) {
  let s = 0;
  for (const p of parts.buttons) {
    let other = false;
    let self = false;
    for (const b of boxes) {
      if (!circleHits(p.x, p.y, BTN / 2 + PAD, b)) continue;
      if (b.i === sel) self = true;
      else other = true;
    }
    if (other) s += 1000;
    if (self) s += 300;
  }
  for (const l of parts.labels) if (boxes.some((b) => rectHits(l, b))) s += 3;
  return s;
}

// boxes: [{i, l, t, r, b}] 쌓기나무 하나의 화면 사각형(스테이지 px), sel: 고른 조각 번호,
// tap: 누른 점, W·H: 스테이지 크기, prev: 지금 떠 있는 링(있으면, 그대로 둬도 되면 그대로 돌려준다).
// -> {x, y, k, layout} 링 가운데(스테이지 px), 크기 배율, 모양('tri' | 'row')
export function placeRing({ boxes, sel, tap, W, H, prev = null }) {
  if (prev) {
    const parts = ringParts(prev);
    if (fitsScreen(parts, W, H) && hitScore(parts, boxes, sel) < 300) return prev;
  }
  // 고른 조각 화면 사각형들의 가운데(없으면 누른 점)
  let l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
  for (const q of boxes) {
    if (q.i !== sel) continue;
    l = Math.min(l, q.l); t = Math.min(t, q.t); r = Math.max(r, q.r); b = Math.max(b, q.b);
  }
  const ax = Number.isFinite(l) ? (l + r) / 2 : tap.x;
  const ay = Number.isFinite(t) ? (t + b) / 2 : tap.y;
  let best = null;
  let bestScore = Infinity;
  for (const c of CANDS) {
    if (c.base >= bestScore) break; // 정렬돼 있으니 뒤는 더 비싸다
    const ring = { x: ax + c.dx, y: ay + c.dy, k: c.k, layout: c.layout };
    const parts = ringParts(ring);
    if (!fitsScreen(parts, W, H)) continue;
    const score = c.base + hitScore(parts, boxes, sel);
    if (score < bestScore) { best = ring; bestScore = score; }
  }
  if (best) return best;
  // 화면이 아주 작아 어디에도 다 들어가지 않으면 누른 점을 화면 안으로 끌어당긴다(예전 방식)
  const ext = {
    left: Math.max(...RING_BUTTONS.map((q) => Math.max(BTN / 2, LABEL_HALF_W) - q.dx)) + EDGE,
    right: Math.max(...RING_BUTTONS.map((q) => q.dx + Math.max(BTN / 2, LABEL_HALF_W))) + EDGE,
    top: Math.max(...RING_BUTTONS.map((q) => BTN / 2 - q.dy)) + EDGE,
    bottom: Math.max(...RING_BUTTONS.map((q) => q.dy + LABEL_GAP + LABEL_H)) + EDGE,
  };
  const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(Math.max(v, lo), hi));
  return { x: clamp(tap.x, ext.left, W - ext.right), y: clamp(tap.y, ext.top, H - ext.bottom), k: 1, layout: 'tri' };
}
