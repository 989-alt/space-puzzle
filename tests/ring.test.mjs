// 돌리기 링 자리(src/scene/ringPlace.js). 링 버튼이 조각(고른 조각·다른 조각)을 덮으면 조각을 누르려던 손가락이
// 버튼을 눌러 한 번 더 돌아간다(2026-10-22 감사 F). 버튼이 쌓기나무 화면 사각형과 겹치지 않는 가장 가까운 자리를 고른다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeRing, ringParts, BTN } from '../src/scene/ringPlace.js';

const W = 1280;
const H = 800;
const R = BTN / 2;

// 칸 하나 = 화면 사각형 하나(조각 i)
const box = (i, l, t, size = 48) => ({ i, l, t, r: l + size, b: t + size });
// 가로로 n 칸 늘어선 조각
const row = (i, l, t, n, size = 48) => Array.from({ length: n }, (_, k) => box(i, l + k * size, t, size));

function circleHitsRect(cx, cy, r, b) {
  const nx = Math.max(b.l, Math.min(cx, b.r));
  const ny = Math.max(b.t, Math.min(cy, b.b));
  return (cx - nx) ** 2 + (cy - ny) ** 2 < r * r;
}
const buttonHits = (ring, boxes) => ringParts(ring).buttons
  .filter((p) => boxes.some((b) => circleHitsRect(p.x, p.y, R, b))).length;
function inside(ring) {
  const { buttons, labels } = ringParts(ring);
  return buttons.every((p) => p.x - R >= 0 && p.x + R <= W && p.y - R >= 0 && p.y + R <= H)
    && labels.every((l) => l.l >= 0 && l.r <= W && l.t >= 0 && l.b <= H);
}

test('ring buttons do not cover the selected piece and stay around it', () => {
  const boxes = row(0, 560, 380, 3); // 144x48 조각, 가운데 (632, 404)
  const ring = placeRing({ boxes, sel: 0, tap: { x: 600, y: 400 }, W, H });
  assert.equal(buttonHits(ring, boxes), 0);
  assert.ok(inside(ring));
  // 링 가운데는 조각 가까이(버튼 한 개 거리 안)
  assert.ok(Math.hypot(ring.x - 632, ring.y - 404) < 80, JSON.stringify(ring));
  // 버튼 세 개가 모두 조각에서 너무 멀지 않다
  for (const p of ringParts(ring).buttons) assert.ok(Math.hypot(p.x - 632, p.y - 404) < 220, JSON.stringify(p));
});

test('ring buttons avoid neighbouring pieces when there is room', () => {
  const boxes = [
    ...row(0, 560, 380, 2),
    ...row(1, 680, 330, 3), // 오른쪽 위 이웃
    ...row(2, 430, 440, 2), // 왼쪽 아래 이웃
    ...row(3, 560, 240, 2), // 위 이웃
  ];
  const ring = placeRing({ boxes, sel: 0, tap: { x: 580, y: 400 }, W, H });
  assert.equal(buttonHits(ring, boxes), 0, JSON.stringify(ringParts(ring)));
  assert.ok(inside(ring));
});

test('ring stays fully on screen near edges', () => {
  for (const [l, t] of [[0, 0], [W - 96, 0], [0, H - 48], [W - 96, H - 48], [600, H - 48]]) {
    const boxes = row(0, l, t, 2);
    const ring = placeRing({ boxes, sel: 0, tap: { x: l + 10, y: t + 10 }, W, H });
    assert.ok(inside(ring), `${l},${t} ${JSON.stringify(ringParts(ring))}`);
    assert.equal(buttonHits(ring, boxes), 0, `${l},${t}`);
  }
});

test('when nothing is free the ring is still on screen and as clear as possible', () => {
  // 화면 전체를 다른 조각 칸으로 덮는다
  const boxes = [];
  for (let x = 0; x < W; x += 48) for (let y = 0; y < H; y += 48) boxes.push(box(1, x, y));
  boxes.push(box(0, 600, 380));
  const ring = placeRing({ boxes, sel: 0, tap: { x: 620, y: 400 }, W, H });
  assert.ok(inside(ring));
  assert.ok(Number.isFinite(ring.x) && Number.isFinite(ring.y));
});

test('placement is deterministic and does not move when already clear', () => {
  const boxes = row(0, 560, 380, 3);
  const a = placeRing({ boxes, sel: 0, tap: { x: 600, y: 400 }, W, H });
  const b = placeRing({ boxes, sel: 0, tap: { x: 600, y: 400 }, W, H });
  assert.deepEqual(a, b);
  // 지금 자리(prev)가 버튼 겹침 없이 화면 안이면 그대로 둔다(연달아 누르는 버튼이 도망가지 않게)
  const kept = placeRing({ boxes, sel: 0, tap: { x: 600, y: 400 }, W, H, prev: a });
  assert.deepEqual(kept, a);
  // 지금 자리가 조각을 덮게 되면(돌려서 모양이 커짐) 새 자리로 옮긴다
  const grown = [...boxes, ...row(0, 560, 380 - 96, 3), ...row(0, 560, 380 + 48, 3)];
  const moved = placeRing({ boxes: grown, sel: 0, tap: { x: 600, y: 400 }, W, H, prev: a });
  assert.equal(buttonHits(moved, grown), 0);
});

test('a wide piece in front of placed pieces gets a ring that covers nothing (row layout below)', () => {
  // 감사 F(s1-020) 실제 화면 사각형: 0·1번은 판 위에 놓였고 2번(4칸, 넓음)은 그 앞. 기본 모양은 2.2배까지 키워도
  // 2번을 둘러쌀 수 없어 돌리기 버튼이 2번 위에 놓였고, 2번을 끌려던 누름이 버튼에 떨어졌다.
  const boxes = [
    { i: 0, l: 640, t: 342, r: 722, b: 453 }, { i: 0, l: 640, t: 274, r: 724, b: 386 }, { i: 0, l: 718, t: 342, r: 804, b: 453 },
    { i: 1, l: 482, t: 302, r: 565, b: 408 }, { i: 1, l: 561, t: 302, r: 640, b: 408 }, { i: 1, l: 558, t: 342, r: 640, b: 453 },
    { i: 1, l: 640, t: 302, r: 719, b: 408 }, { i: 1, l: 715, t: 302, r: 798, b: 408 },
    { i: 2, l: 640, t: 432, r: 728, b: 551 }, { i: 2, l: 723, t: 432, r: 815, b: 551 }, { i: 2, l: 806, t: 432, r: 903, b: 551 },
    { i: 2, l: 809, t: 361, r: 909, b: 482 },
  ];
  const ring = placeRing({ boxes, sel: 2, tap: { x: 767, y: 491 }, W, H });
  assert.equal(buttonHits(ring, boxes), 0, JSON.stringify(ring));
  assert.ok(inside(ring));
});

test('placement is fast (< 15 ms for 5 pieces of 6 cubes)', () => {
  const boxes = [];
  for (let i = 0; i < 5; i++) boxes.push(...row(i, 300 + i * 130, 300 + (i % 2) * 90, 6, 40));
  placeRing({ boxes, sel: 2, tap: { x: 600, y: 400 }, W, H });
  let worst = 0;
  for (let k = 0; k < 5; k++) {
    const t0 = performance.now();
    placeRing({ boxes, sel: k, tap: { x: 600, y: 400 }, W, H });
    worst = Math.max(worst, performance.now() - t0);
  }
  assert.ok(worst < 15, `${worst.toFixed(1)}ms`);
});

// 화면 UI(단서 카드·도구 막대·위쪽 칩 등) 위에 링 버튼이 놓이면 그 UI 를 누르려던 손가락이 링 버튼을 누른다(F 와 같은 종류).
const rectHit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
function uiHits(ring, ui) {
  const { buttons, labels } = ringParts(ring);
  const bh = buttons.filter((p) => ui.some((u) => circleHitsRect(p.x, p.y, R, u))).length;
  const lh = labels.filter((l) => ui.some((u) => rectHit(l, u))).length;
  return bh + lh;
}

test('ring buttons and labels avoid UI overlays (clue card on the right, tools at the bottom)', () => {
  const ui = [
    { l: 1030, t: 88, r: 1260, b: 420 }, // 단서 카드
    { l: 880, t: 700, r: 1255, b: 780 }, // 도구 막대
    { l: 450, t: 20, r: 830, b: 80 }, // 미션
  ];
  // 단서 카드 바로 왼쪽 조각: 가장 가까운 링 자리는 카드 위에 걸친다
  const boxes = row(0, 900, 200, 2);
  const ring = placeRing({ boxes, sel: 0, tap: { x: 940, y: 220 }, W, H, ui });
  assert.equal(uiHits(ring, ui), 0, JSON.stringify(ringParts(ring)));
  assert.equal(buttonHits(ring, boxes), 0);
  // 도구 막대 바로 위 조각
  const low = row(0, 950, 600, 3);
  const r2 = placeRing({ boxes: low, sel: 0, tap: { x: 1000, y: 620 }, W, H, ui });
  assert.equal(uiHits(r2, ui), 0, JSON.stringify(ringParts(r2)));
  assert.equal(buttonHits(r2, low), 0);
  // UI 를 모르면(ui 없음) 같은 자리에서 카드와 겹치는 자리를 고를 수 있다(시험이 의미 있는지 확인)
  const blind = placeRing({ boxes, sel: 0, tap: { x: 940, y: 220 }, W, H });
  assert.ok(uiHits(blind, ui) > 0, 'scenario must be non-trivial');
});

test('a kept ring that now overlaps UI is moved', () => {
  const ui = [{ l: 1030, t: 88, r: 1260, b: 420 }];
  const boxes = row(0, 900, 200, 2);
  const prev = placeRing({ boxes, sel: 0, tap: { x: 940, y: 220 }, W, H });
  const r = placeRing({ boxes, sel: 0, tap: { x: 940, y: 220 }, W, H, ui, prev });
  assert.equal(uiHits(r, ui), 0);
});

// 2차 브라우저 감사(s2-006): 세운 조각(화면에서 키가 큼) 양옆·아래에 다른 조각이 있어 가까운 자리(SPAN)가 모두
// 버튼으로 고른 조각을 덮었다. 그 버튼에 조각 누름이 떨어져 한 번 더 돌아갔다. 이제 더 멀리 덮지 않는 자리를 찾는다.
test('tall standing piece boxed in by neighbours gets a clear ring farther away', () => {
  const boxes = [
    { i: 0, l: 561, t: 302, r: 640, b: 408 }, { i: 0, l: 640, t: 302, r: 719, b: 408 },
    { i: 0, l: 640, t: 234, r: 721, b: 342 }, { i: 0, l: 715, t: 302, r: 798, b: 408 },
    { i: 1, l: 853, t: 227, r: 938, b: 327 }, { i: 1, l: 857, t: 163, r: 944, b: 263 },
    { i: 1, l: 861, t: 95, r: 950, b: 197 }, { i: 1, l: 924, t: 227, r: 1012, b: 327 },
    { i: 2, l: 723, t: 432, r: 815, b: 551 }, { i: 2, l: 806, t: 432, r: 903, b: 551 },
    { i: 2, l: 880, t: 386, r: 979, b: 500 }, { i: 2, l: 888, t: 432, r: 991, b: 551 },
  ];
  // 그때 화면 UI(1280x800 게임 화면): 위쪽 칩·섬 배지·미션·점수·단서 카드·도구 막대
  const ui = [
    { l: 26, t: 19, r: 227, b: 59 }, { l: 26, t: 84, r: 253, b: 153 }, { l: 320, t: 21, r: 960, b: 80 },
    { l: 1140, t: 19, r: 1254, b: 73 }, { l: 1024, t: 88, r: 1254, b: 358 }, { l: 906, t: 710, r: 1254, b: 776 },
  ];
  const ring = placeRing({ boxes, sel: 1, tap: { x: 899, y: 212 }, W, H, ui });
  assert.equal(buttonHits(ring, boxes), 0, JSON.stringify(ring));
  assert.equal(buttonHits(ring, ui), 0, JSON.stringify(ring));
  assert.ok(inside(ring));
  // 한 번 고른 자리는 다시 돌린 뒤에도 그대로(prev 유지)
  assert.deepEqual(placeRing({ boxes, sel: 1, tap: { x: 899, y: 212 }, W, H, prev: ring, ui }), ring);
});
