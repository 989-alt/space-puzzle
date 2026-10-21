// 배경 그림 속 원형 작업대(금테 안쪽 돌바닥)에 3D 카메라를 맞춘다.
// 렌더러·DOM 없이 투영만 쓴다(Node 테스트에서도 돈다). addons 는 쓰지 않는다.
import { Vector3 } from '#three';

// game-bg-v4.png(1344x768) 픽셀 기준 작업대 타원: 중심 (cx, cy), 가로 반지름 a, 세로 반지름 b.
export const BG = { w: 1344, h: 768, cx: 672, cy: 418, a: 440, b: 250 };

const ITER = 6;

// 화면 W x H 에서 그림이 background-size: cover; background-position: center 로 깔릴 때의 타원(px).
export function bgEllipse(W, H) {
  const s = Math.max(W / BG.w, H / BG.h);
  const ox = (W - BG.w * s) / 2;
  const oy = (H - BG.h * s) / 2;
  return { cx: ox + BG.cx * s, cy: oy + BG.cy * s, a: BG.a * s, b: BG.b * s };
}

// 월드 원점(작업대 중심)을 바라보는 카메라를 앞(+z)·위에서 두고, 반지름 R 원을 투영한 타원의
// 좌우·위아래 끝이 그림 속 타원에 맞도록 거리·내려다보는 각도·화면 오프셋을 6번 고친다.
// 반환값은 최종 오차(px): 중심 x·y, 가로·세로 반지름.
export function fitCamera(camera, W, H, { R = 6, fov = 22 } = {}) {
  const t = bgEllipse(W, H);
  camera.fov = fov;
  camera.aspect = W / H;
  const f = H / 2 / Math.tan((fov * Math.PI) / 360); // 초점거리(px)
  let D = (R * f) / t.a;
  let pitch = Math.asin(BG.b / BG.a);
  let offY = H / 2 - t.cy;

  const v = new Vector3();
  const pr = (x, y, z) => {
    v.set(x, y, z).project(camera);
    return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
  };
  const place = () => {
    camera.position.set(0, D * Math.sin(pitch), D * Math.cos(pitch));
    camera.lookAt(0, 0, 0);
    camera.setViewOffset(W, H, W / 2 - t.cx, offY, W, H);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  };
  const measure = () => {
    const tp = pr(0, 0, -R), bt = pr(0, 0, R), lf = pr(-R, 0, 0), rt = pr(R, 0, 0);
    return {
      x: (rt[0] + lf[0]) / 2,
      y: (bt[1] + tp[1]) / 2,
      a: (rt[0] - lf[0]) / 2,
      b: (bt[1] - tp[1]) / 2,
    };
  };

  for (let i = 0; i < ITER; i++) {
    place();
    const m = measure();
    D *= m.a / t.a;
    pitch = Math.asin(Math.min(0.99, (Math.sin(pitch) * t.b) / m.b));
    offY += m.y - t.cy;
  }
  place();
  const m = measure();
  return { errX: m.x - t.cx, errY: m.y - t.cy, errA: m.a - t.a, errB: m.b - t.b };
}
