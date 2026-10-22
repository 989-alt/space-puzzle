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
