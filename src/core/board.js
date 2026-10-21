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

// cells를 (x, z) 위에 놓았을 때 occupied와 겹치지 않는 가장 낮은 y(>= 0)
export function dropY(cells, x, z, occupied) {
  let top = -1;
  for (const k of occupied) top = Math.max(top, Number(k.split(',')[1]));
  for (let y = 0; y <= top + 1; y++) {
    if (!cells.some((c) => occupied.has(key([c[0] + x, c[1] + y, c[2] + z])))) return y;
  }
  return top + 1;
}
