// 화면 UI 사각형 아래로 투영되는 판 칸 찾기(Node, 렌더러 없이 투영만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from '#three';
import { fitCamera } from '../src/scene/calibrate.js';
import { avoidColumns } from '../src/scene/avoid.js';

const W = 1280;
const H = 800;
const center = { x: 2.5, z: 2 };

function cam() {
  const c = new PerspectiveCamera(22, W / H, 0.1, 500);
  fitCamera(c, W, H);
  return c;
}

// 칸 (x, z) 의 높이 0..h 상자가 화면에서 차지하는 사각형
function boxOf(c, x, z, h) {
  const v = new Vector3();
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const dx of [0, 1]) for (const dz of [0, 1]) for (const y of [0, h]) {
    v.set(x + dx - center.x, y, z + dz - center.z).project(c);
    const sx = ((v.x + 1) / 2) * W;
    const sy = ((1 - v.y) / 2) * H;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  return { x0, y0, x1, y1 };
}
const hits = (b, r) => b.x1 > r.l && b.x0 < r.r && b.y1 > r.t && b.y0 < r.b;

test('avoidColumns returns exactly the columns whose box meets a rect', () => {
  const c = cam();
  const rect = { l: 980, t: 85, r: 1220, b: 440 }; // 오른쪽 위 단서 카드 자리
  const set = avoidColumns(c, [rect], center, { W, H, maxH: 2, margin: 0 });
  assert.ok(set instanceof Set);
  assert.ok(set.size > 0);
  for (let x = -4; x <= 9; x++) {
    for (let z = -5; z <= 8; z++) {
      assert.equal(set.has(`${x},${z}`), hits(boxOf(c, x, z, 2), rect), `${x},${z}`);
    }
  }
  assert.ok(!set.has('2,2'), 'the board center is not under the card');
});

test('avoidColumns margin grows the set, no rects gives an empty set', () => {
  const c = cam();
  const rect = { l: 980, t: 85, r: 1220, b: 440 };
  const a = avoidColumns(c, [rect], center, { W, H, maxH: 2, margin: 0 });
  const b = avoidColumns(c, [rect], center, { W, H, maxH: 2, margin: 40 });
  assert.ok(b.size > a.size);
  for (const k of a) assert.ok(b.has(k));
  assert.equal(avoidColumns(c, [], center, { W, H }).size, 0);
});
