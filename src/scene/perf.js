// WebGL 생성 실패 처리와 저사양 자동 전환.
import * as THREE from '#three';

export const MAX_PIXEL_RATIO = 1.75;
const WINDOW_MS = 3000; // 평균을 내는 구간
const LOW_FPS = 40;

// 렌더러를 만든다. WebGL 을 쓸 수 없으면 null.
export function createRenderer(canvas) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    if (!renderer.getContext()) return null;
  } catch (err) {
    return null;
  }
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  return renderer;
}

// 3초 평균 fps 가 40 미만이면 그림자를 끄고 픽셀 비율을 1로 내린 뒤 onLow() 를 한 번 부른다.
// 탭이 숨겨진 동안의 구간은 버린다. 멈추는 함수를 돌려준다.
export function watchFps(renderer, world, onLow) {
  let frames = 0;
  let start = null;
  let raf = 0;
  let stopped = false;
  const tick = (now) => {
    if (stopped) return;
    if (globalThis.document && document.hidden) {
      start = null;
    } else if (start === null) {
      start = now;
      frames = 0;
    } else {
      frames++;
      const span = now - start;
      if (span >= WINDOW_MS) {
        const fps = (frames * 1000) / span;
        if (fps < LOW_FPS) {
          stopped = true;
          renderer.setPixelRatio(1);
          if (world && world.setShadows) world.setShadows(false);
          else renderer.shadowMap.enabled = false;
          if (onLow) onLow(fps);
          return;
        }
        start = now;
        frames = 0;
      }
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { stopped = true; cancelAnimationFrame(raf); };
}
