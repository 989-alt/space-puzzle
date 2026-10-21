// 칸 회전·정규화·크기·방향 목록·눕히기. 순수 함수만 둔다(React·브라우저 API 금지).
// 좌표: 칸 [x, y, z], y가 위, +z가 앞.

export const key = (c) => `${c[0]},${c[1]},${c[2]}`;

// 최소 좌표를 0으로 옮기고 (x, y, z) 사전순으로 정렬한다. -0은 0으로 바꾼다.
export function normalize(cells) {
  const min = [0, 1, 2].map((i) => Math.min(...cells.map((c) => c[i])));
  return cells
    .map((c) => [c[0] - min[0] + 0, c[1] - min[1] + 0, c[2] - min[2] + 0])
    .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
}

const ROT = {
  y: ([x, y, z]) => [z, y, -x],
  x: ([x, y, z]) => [x, -z, y],
  z: ([x, y, z]) => [-y, x, z],
};

// 한 점(벡터)을 axis 로 90도 돌린다(rotate 와 같은 방향). 반 칸 좌표에도 쓴다.
export const turn = (v, axis) => ROT[axis](v);

export function rotate(cells, axis) {
  return normalize(cells.map(ROT[axis]));
}

export function dims(cells) {
  const n = normalize(cells);
  return [0, 1, 2].map((i) => Math.max(...n.map((c) => c[i])) + 1);
}

const sig = (cells) => cells.map(key).join(';');

// 90도 회전 세 축을 닫을 때까지 돌려 얻은 중복 없는 방향 목록(최대 24개).
export function orientations(cells) {
  const start = normalize(cells);
  const seen = new Map([[sig(start), start]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const axis of ['x', 'y', 'z']) {
      const next = rotate(cur, axis);
      const s = sig(next);
      if (!seen.has(s)) {
        seen.set(s, next);
        queue.push(next);
      }
    }
  }
  return [...seen.values()];
}

// 높이 h가 가장 낮은 방향 중, 긴 변이 longAxis('x'|'z') 쪽에 오는 방향.
export function lieFlat(cells, longAxis) {
  const li = longAxis === 'z' ? 2 : 0;
  const oi = longAxis === 'z' ? 0 : 2;
  const list = orientations(cells).map((o) => ({ o, d: dims(o) }));
  const minH = Math.min(...list.map((e) => e.d[1]));
  let best = null;
  for (const e of list) {
    if (e.d[1] !== minH) continue;
    const score = e.d[li] - e.d[oi];
    if (!best || score > best.score) best = { o: e.o, score };
  }
  return best.o;
}
