// WebGL 생성 실패 처리와 저사양 자동 전환.
import * as THREE from '#three';

export const MAX_PIXEL_RATIO = 1.75;
const WINDOW_MS = 3000; // 평균을 내는 구간
const LOW_FPS = 40;
const WARMUP_MS = 1000; // 시작 직후(셰이더 컴파일·첫 그림자 맵) 버리는 구간
const WARMUP_FRAMES = 30;

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

// 그린 프레임만 재는 fps 측정기. 렌더 루프가 실제로 그린 프레임마다 frame(now), 그리지 않았거나
// 화면이 가려졌으면 gap() 을 부른다. 이어서 그린 두 프레임 사이 간격만 더하므로 쉬는 구간은 느린
// 프레임으로 세지 않는다. 그린 시간이 3초 쌓이면 평균 fps 를 보고, 40 미만이면 그림자를 끄고 픽셀
// 비율을 1로 내린 뒤 onLow(fps) 를 한 번 부른다. 첫 그린 프레임 뒤 1초와 30프레임은 버린다(셰이더
// 컴파일·첫 그림자 맵). pause() 동안(도움말 등 겹친 화면의 흐림 효과)은 재지 않는다.
export function createFpsMeter(renderer, world, onLow) {
  let first = null;
  let warm = 0;
  let prev = null;
  let span = 0;
  let frames = 0;
  let paused = false;
  let done = false;
  return {
    frame(now) {
      if (done || paused) return;
      if (first === null) first = now;
      if (warm < WARMUP_FRAMES || now - first < WARMUP_MS) {
        warm++;
        prev = null;
        return;
      }
      if (prev !== null) {
        span += now - prev;
        frames++;
      }
      prev = now;
      if (span >= WINDOW_MS) {
        const fps = (frames * 1000) / span;
        span = 0;
        frames = 0;
        if (fps < LOW_FPS) {
          done = true;
          renderer.setPixelRatio(1);
          if (world && world.setShadows) world.setShadows(false);
          else renderer.shadowMap.enabled = false;
          if (onLow) onLow(fps);
        }
      }
    },
    gap() { prev = null; },
    pause() { paused = true; prev = null; },
    resume() { paused = false; prev = null; },
    stop() { done = true; },
    get done() { return done; },
  };
}

// requestAnimationFrame 으로 스스로 재는 판(확인용 장면 페이지 등). 탭이 숨겨진 동안은 버린다.
// 멈추는 함수를 돌려준다.
export function watchFps(renderer, world, onLow) {
  const meter = createFpsMeter(renderer, world, onLow);
  let raf = 0;
  const tick = (now) => {
    if (globalThis.document && document.hidden) meter.gap();
    else meter.frame(now);
    if (meter.done) return;
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => { meter.stop(); cancelAnimationFrame(raf); };
}
