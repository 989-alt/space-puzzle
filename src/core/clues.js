// 단서 표현: 바닥판, 위+수, 층별, 위·앞·옆. 순수 함수만 둔다(three.js·DOM 금지).
// 좌표: 칸 [x, y, z], y가 위, +z가 앞. 판 칸 = 목표의 y=0 칸, 최소 x·z는 0.
// 격자에서 판 밖(0 <= x < w, 0 <= z < d 를 벗어난) 칸은 무시한다.
import { key } from './pieces.js';

// 최대 높이(맨 위 칸 y + 1). 빈 목록이면 0.
export const height = (cells) => cells.reduce((h, c) => Math.max(h, c[1] + 1), 0);

const grid = (rows, cols, v) => Array.from({ length: rows }, () => Array(cols).fill(v));
const inGrid = (c, fp) => c[0] >= 0 && c[0] < fp.w && c[2] >= 0 && c[2] < fp.d;

// 목표의 y=0 칸이 판이다. w·d는 최대 x·z + 1.
export function footprint(target) {
  const cells = new Set();
  let w = 0, d = 0;
  for (const c of target) {
    if (c[1] !== 0) continue;
    cells.add(`${c[0]},${c[2]}`);
    w = Math.max(w, c[0] + 1);
    d = Math.max(d, c[2] + 1);
  }
  return { w, d, cells };
}

// y > 0 인 칸 아래(y−1)가 비어 있으면 true.
export function hasOverhang(cells) {
  const set = new Set(cells.map(key));
  return cells.some((c) => c[1] > 0 && !set.has(key([c[0], c[1] - 1, c[2]])));
}

// [z][x] 기둥별 칸 수. 행 = z 오름차순(뒤→앞), 열 = x.
export function topCounts(cells, fp) {
  const g = grid(fp.d, fp.w, 0);
  for (const c of cells) if (inGrid(c, fp)) g[c[2]][c[0]] += 1;
  return g;
}

// [z][x] 위에서 본 모양(그 기둥에 칸이 하나라도 있으면 true).
export function topView(cells, fp) {
  return topCounts(cells, fp).map((row) => row.map((n) => n > 0));
}

// [y][z][x] 층별 격자. 0번이 1층(바닥).
export function layerGrids(cells, fp) {
  const g = Array.from({ length: height(cells) }, () => grid(fp.d, fp.w, false));
  for (const c of cells) if (inGrid(c, fp) && c[1] >= 0) g[c[1]][c[2]][c[0]] = true;
  return g;
}

// 앞(+z)에서 본 모양. 행 0 = 맨 위층(y = H−1), 열 = x 왼→오.
export function frontView(cells, fp, H = height(cells)) {
  const g = grid(H, fp.w, false);
  for (const c of cells) if (inGrid(c, fp) && c[1] >= 0 && c[1] < H) g[H - 1 - c[1]][c[0]] = true;
  return g;
}

// 오른쪽 옆(+x)에서 본 모양. 행 0 = 맨 위층, 열 = z 내림차순(앞→뒤, 오른쪽에서 보면 앞이 왼쪽).
export function sideView(cells, fp, H = height(cells)) {
  const g = grid(H, fp.d, false);
  for (const c of cells) if (inGrid(c, fp) && c[1] >= 0 && c[1] < H) g[H - 1 - c[1]][fp.d - 1 - c[2]] = true;
  return g;
}

// 단계별 단서. level 1은 3D 고스트라 목표 칸을 그대로 쓰므로 fp만 담는다.
// 앞·옆 모양의 높이 H는 목표의 최대 높이로 고정한다.
export function clueFor(target, level) {
  const fp = footprint(target);
  const clue = { level, fp };
  if (level === 2) clue.counts = topCounts(target, fp);
  if (level === 3) clue.layers = layerGrids(target, fp);
  if (level === 4) {
    const H = height(target);
    clue.top = topView(target, fp);
    clue.front = frontView(target, fp, H);
    clue.side = sideView(target, fp, H);
  }
  return clue;
}
