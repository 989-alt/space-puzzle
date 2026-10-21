// 배경 그림 속 작업대 타원에 카메라를 맞추는 보정 검사(Node, 렌더러 없이 투영만).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera } from '#three';
import { BG, fitCamera } from '../src/scene/calibrate.js';

test('calibrationAcrossAspects', () => {
  for (const [W, H] of [[1120, 700], [1366, 768], [1024, 768], [1280, 800], [2000, 1000]]) {
    const cam = new PerspectiveCamera(22, W / H, 0.1, 500);
    const e = fitCamera(cam, W, H);
    const a = BG.a * Math.max(W / BG.w, H / BG.h);
    for (const v of [e.errX, e.errY, e.errA, e.errB]) {
      assert.ok(Number.isFinite(v), `${W}x${H} ${JSON.stringify(e)}`);
      assert.ok(Math.abs(v) < a * 0.02, `${W}x${H} ${JSON.stringify(e)}`);
    }
  }
});

test('fitCamera looks at the world origin from the front (+z) and above', () => {
  const cam = new PerspectiveCamera(22, 1.6, 0.1, 500);
  fitCamera(cam, 1120, 700);
  assert.ok(cam.position.y > 0);
  assert.ok(cam.position.z > 0);
  assert.ok(Math.abs(cam.position.x) < 1e-9);
  assert.equal(cam.aspect, 1120 / 700);
});
