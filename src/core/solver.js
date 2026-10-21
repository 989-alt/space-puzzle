// 정확 덮기 해답 탐색 + 낙하 순서 가능 검사. 순수 함수만 둔다(three.js·DOM 금지).
// 좌표: 칸 [x, y, z], y가 위. 배치 = { cells(정규화된 한 방향), pos: [x, y, z] }.
import { key, orientations } from './pieces.js';
import { worldCells, dropY } from './board.js';

// 탐색 순서: 낮은 y → z → x.
const byYZX = (a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0];

// 이미 놓인 조각들의 점유 상태에서 dropY가 자기 y와 같은 조각을 하나씩 놓아 전부 놓이면 true.
// 먼저 놓아도 되는 조각이 다른 조각의 자리를 위에서 덮을 수 있어(돌출부) 탐욕 순서로는
// 틀릴 수 있으므로, 놓인 조각 집합(비트마스크)을 기억하며 순서를 깊이 우선으로 찾는다.
export function dropOrderExists(placements) {
  const n = placements.length;
  const world = placements.map((p) => worldCells(p).map(key));
  const full = (1 << n) - 1;
  const dead = new Set();
  const dfs = (mask, occ) => {
    if (mask === full) return true;
    if (dead.has(mask)) return false;
    for (let i = 0; i < n; i++) {
      if (mask & (1 << i)) continue;
      const p = placements[i];
      if (dropY(p.cells, p.pos[0], p.pos[2], occ) !== p.pos[1]) continue;
      const next = new Set(occ);
      for (const k of world[i]) next.add(k);
      if (dfs(mask | (1 << i), next)) return true;
    }
    dead.add(mask);
    return false;
  };
  return dfs(0, new Set());
}

// 회전으로 겹치는 모양끼리 같은 값. 같은 모양 조각을 서로 바꾼 해답을 한 번만 세는 데 쓴다.
const shapeId = (orients) => orients.map((o) => o.map(key).join(';')).sort()[0];

// target 칸을 조각 전부로 정확히 덮는 배치를 찾는다. 각 조각은 orientations × 평행이동.
// 가장 낮은 y·z·x 빈 칸부터 덮는다: 그 칸을 덮는 조각 칸은 조각의 (y,z,x) 최소 칸이어야 한다.
// 같은 모양 조각을 맞바꾼 배치는 같은 해답으로 보고 한 번만 센다.
// dropCheck(기본 true)면 낙하 순서가 가능한 해답만 센다. count는 limit에서 멈춘다.
export function solve(target, pieceCellsList, { limit = 50, dropCheck = true } = {}) {
  const tset = new Set(target.map(key));
  const total = pieceCellsList.reduce((s, cells) => s + cells.length, 0);
  const result = { count: 0, solutions: [] };
  if (total !== tset.size || tset.size !== target.length) return result;

  const n = pieceCellsList.length;
  const orients = pieceCellsList.map((cells) =>
    orientations(cells).map((o) => ({ cells: o, anchor: [...o].sort(byYZX)[0] })),
  );
  const ids = orients.map((os) => shapeId(os.map((o) => o.cells)));
  const order = [...target].sort(byYZX).map((c) => ({ c, k: key(c) }));
  const covered = new Set();
  const used = new Array(n).fill(false);
  const placed = new Array(n);

  const rec = (from) => {
    if (result.count >= limit) return;
    let i0 = from;
    while (i0 < order.length && covered.has(order[i0].k)) i0++;
    if (i0 === order.length) {
      const sol = placed.map((p) => ({ cells: p.cells.map((c) => [...c]), pos: [...p.pos] }));
      if (!dropCheck || dropOrderExists(sol)) {
        result.solutions.push(sol);
        result.count++;
      }
      return;
    }
    const t = order[i0].c;
    const tried = new Set();
    for (let i = 0; i < n; i++) {
      if (used[i] || tried.has(ids[i])) continue;
      tried.add(ids[i]);
      for (const o of orients[i]) {
        const pos = [t[0] - o.anchor[0], t[1] - o.anchor[1], t[2] - o.anchor[2]];
        const keys = [];
        let ok = true;
        for (const c of o.cells) {
          const k = key([c[0] + pos[0], c[1] + pos[1], c[2] + pos[2]]);
          if (!tset.has(k) || covered.has(k)) { ok = false; break; }
          keys.push(k);
        }
        if (!ok) continue;
        for (const k of keys) covered.add(k);
        used[i] = true;
        placed[i] = { cells: o.cells, pos };
        rec(i0 + 1);
        used[i] = false;
        for (const k of keys) covered.delete(k);
        if (result.count >= limit) return;
      }
    }
  };
  rec(0);
  return result;
}
