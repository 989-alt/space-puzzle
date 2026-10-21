// 낙하 높이, 점유 집합, 월드 칸. 순수 함수만 둔다.
import { key } from './pieces.js';

// piece = { cells, pos: [x, y, z] } -> 월드 좌표 칸
export const worldCells = (piece) =>
  piece.cells.map((c) => [c[0] + piece.pos[0], c[1] + piece.pos[1], c[2] + piece.pos[2]]);

// exceptIndex 번째 조각을 뺀 모든 조각의 월드 칸 키 집합
export function occupiedSet(pieces, exceptIndex) {
  const set = new Set();
  pieces.forEach((p, i) => {
    if (i === exceptIndex) return;
    for (const c of worldCells(p)) set.add(key(c));
  });
  return set;
}

// 위에서 떨어뜨리듯 놓는 높이(>= 0). 각 칸이 자기 기둥의 가장 높은 점유 칸 위에 얹히는
// 높이 중 최대값이라, 돌출부 밑 빈 칸으로 미끄러져 들어가지 않는다.
export function dropY(cells, x, z, occupied) {
  const top = new Map(); // "x,z" -> 그 기둥의 가장 높은 점유 y
  for (const k of occupied) {
    const [ox, oy, oz] = k.split(',').map(Number);
    const col = `${ox},${oz}`;
    if (!top.has(col) || oy > top.get(col)) top.set(col, oy);
  }
  let y = 0;
  for (const c of cells) {
    const t = top.get(`${c[0] + x},${c[2] + z}`) ?? -1;
    y = Math.max(y, t + 1 - c[1]);
  }
  return y;
}
