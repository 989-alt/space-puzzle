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

// 중력: 받침이 빠진 조각을 아래로 떨어뜨린다. 낮은 조각부터 한 칸씩 내려 보내며, 바로 아래 칸이
// 바닥(y=0)이거나 다른 조각이면 멈춘다(위에서 다시 떨어뜨리지 않아 돌출부 밑 조각도 그대로다).
// 바뀐 조각이 없을 때까지 되풀이한다. exceptIndex 번째(끄는 중인 조각)는 움직이지 않지만 받침은 된다.
// 새 배열을 돌려준다. 움직이지 않은 조각은 같은 객체, 움직인 조각은 pos 만 바꾼 새 객체다.
export function settleAll(pieces, exceptIndex = -1) {
  const out = pieces.slice();
  for (let changed = true; changed;) {
    changed = false;
    const order = out.map((_, i) => i).filter((i) => i !== exceptIndex)
      .sort((a, b) => out[a].pos[1] - out[b].pos[1]);
    for (const i of order) {
      const p = out[i];
      const occ = occupiedSet(out, i);
      const [x, , z] = p.pos;
      let y = p.pos[1];
      while (y > 0 && p.cells.every((c) => !occ.has(key([c[0] + x, c[1] + y - 1, c[2] + z])))) y--;
      if (y !== p.pos[1]) {
        out[i] = { ...p, pos: [x, y, z] };
        changed = true;
      }
    }
  }
  return out;
}
