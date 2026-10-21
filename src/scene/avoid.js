// 화면 위 UI(단서 카드·HUD) 사각형 아래로 가려지는 판 칸을 찾는다. 렌더러·DOM 없이 투영만 쓴다.
// 회전판을 돌리지 않은 상태(처음 시점)를 기준으로 한다. 시작 배치에서 조각이 카드에 가려지지 않게 쓴다.
import { Vector3 } from '#three';
import { ISLAND_R } from '../core/layout.js';

// camera: fitCamera 로 맞춘 카메라, rects: [{l, t, r, b}] 화면 픽셀, center: 판 중심(칸 좌표),
// W·H: 화면 크기(px), maxH: 조각 높이(칸), margin: 사각형을 사방으로 넓히는 여유(px).
// -> Set("x,z") 칸 위에 세운 높이 maxH 상자의 화면 사각형이 어느 rect 와 겹치는 칸들
export function avoidColumns(camera, rects, center, { W, H, maxH = 2, margin = 10 } = {}) {
  const out = new Set();
  if (!rects.length) return out;
  const v = new Vector3();
  const x0 = Math.floor(center.x - ISLAND_R) - 1;
  const x1 = Math.ceil(center.x + ISLAND_R) + 1;
  const z0 = Math.floor(center.z - ISLAND_R) - 1;
  const z1 = Math.ceil(center.z + ISLAND_R) + 1;
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      let bl = Infinity, bt = Infinity, br = -Infinity, bb = -Infinity;
      for (const dx of [0, 1]) {
        for (const dz of [0, 1]) {
          for (const y of [0, maxH]) {
            v.set(x + dx - center.x, y, z + dz - center.z).project(camera);
            const sx = ((v.x + 1) / 2) * W;
            const sy = ((1 - v.y) / 2) * H;
            if (sx < bl) bl = sx;
            if (sx > br) br = sx;
            if (sy < bt) bt = sy;
            if (sy > bb) bb = sy;
          }
        }
      }
      if (rects.some((r) => br > r.l - margin && bl < r.r + margin && bb > r.t - margin && bt < r.b + margin)) {
        out.add(`${x},${z}`);
      }
    }
  }
  return out;
}
