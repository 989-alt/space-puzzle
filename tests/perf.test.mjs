// watchFps: 시작 직후(셰이더 컴파일·첫 그림자) 멈칫은 무시하고, 계속 느릴 때만 저사양으로 바꾼다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchFps, createFpsMeter } from '../src/scene/perf.js';

// requestAnimationFrame 을 손으로 돌리는 가짜 시계
function fakeRaf() {
  let cb = null;
  globalThis.requestAnimationFrame = (f) => { cb = f; return 1; };
  globalThis.cancelAnimationFrame = () => { cb = null; };
  return (times) => { for (const t of times) { const f = cb; cb = null; if (!f) return; f(t); } };
}
const frames = (from, to, fps) => { const out = []; for (let t = from; t <= to; t += 1000 / fps) out.push(t); return out; };
const spies = () => {
  const log = [];
  return {
    log,
    renderer: { setPixelRatio: (r) => log.push(['pr', r]), shadowMap: { enabled: true } },
    world: { setShadows: (on) => log.push(['shadows', on]) },
  };
};

test('startup hitch does not force low mode', () => {
  const run = fakeRaf();
  const s = spies();
  let low = 0;
  watchFps(s.renderer, s.world, () => low++);
  // 첫 프레임 뒤 1.5초 멈칫(컴파일), 그 뒤 60fps 로 5초
  run([0, 1500, ...frames(1516, 6500, 60)]);
  assert.equal(low, 0);
  assert.deepEqual(s.log, []);
});

test('sustained low fps switches to low mode once', () => {
  const run = fakeRaf();
  const s = spies();
  let low = 0;
  watchFps(s.renderer, s.world, () => low++);
  run(frames(0, 9000, 20));
  assert.equal(low, 1);
  assert.deepEqual(s.log, [['pr', 1], ['shadows', false]]);
});

// 렌더 루프가 그린 프레임만 잰다: 쉬는 구간(gap)은 느린 프레임으로 세지 않는다.
test('meter ignores idle gaps between rendered bursts', () => {
  const s = spies();
  let low = 0;
  const m = createFpsMeter(s.renderer, s.world, () => low++);
  // 60fps 로 0.5초 그리고 2초 쉬기를 10번(쉬는 동안은 gap)
  for (let k = 0; k < 10; k++) {
    const t0 = k * 2500;
    for (const t of frames(t0, t0 + 500, 60)) m.frame(t);
    m.gap();
  }
  assert.equal(low, 0);
  assert.deepEqual(s.log, []);
});

test('meter adds up slow rendered bursts across gaps and switches once', () => {
  const s = spies();
  let low = 0;
  const m = createFpsMeter(s.renderer, s.world, () => low++);
  for (let k = 0; k < 12; k++) {
    const t0 = k * 3000;
    for (const t of frames(t0, t0 + 1000, 20)) m.frame(t);
    m.gap();
  }
  assert.equal(low, 1);
  assert.deepEqual(s.log, [['pr', 1], ['shadows', false]]);
});

test('paused meter does not count frames', () => {
  const s = spies();
  let low = 0;
  const m = createFpsMeter(s.renderer, s.world, () => low++);
  m.pause();
  for (const t of frames(0, 9000, 10)) m.frame(t);
  assert.equal(low, 0);
  m.resume();
  for (const t of frames(9000, 9500, 60)) m.frame(t);
  assert.equal(low, 0);
});
