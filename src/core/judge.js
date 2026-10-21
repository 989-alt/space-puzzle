// 지금 보이는 단서 기준 정답 판정. 순수 함수만 둔다(three.js·DOM 금지).
// 스펙 4.1: 단서 1·2·3은 모양이 하나로 정해지므로 목표 칸 집합과 같아야 하고,
// 단서 4(위·앞·옆)는 세 모양이 모두 맞고 아래가 빈 칸이 없으면 정답이다.
import { key } from './pieces.js';
import { worldCells } from './board.js';
import { footprint, hasOverhang, height, topView, frontView, sideView } from './clues.js';

const sameGrid = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 칸 키 집합. 같은 칸이 두 번 나오면(조각 겹침) null.
function keySet(cells) {
  const set = new Set(cells.map(key));
  return set.size === cells.length ? set : null;
}

const onFootprint = (cells, fp) => cells.every((c) => fp.cells.has(`${c[0]},${c[2]}`));

export function matchesClue(cells, target, level) {
  const set = keySet(cells);
  if (!set || hasOverhang(cells)) return false;
  if (level !== 4) {
    const want = new Set(target.map(key));
    if (set.size !== want.size) return false;
    for (const k of want) if (!set.has(k)) return false;
    return true;
  }
  const fp = footprint(target);
  if (!onFootprint(cells, fp)) return false;
  // 더 높은 다른 모양도 같은 크기 격자로 비교해 '다름'으로 나오게 한다.
  const H = Math.max(height(cells), height(target));
  return (
    sameGrid(topView(cells, fp), topView(target, fp)) &&
    sameGrid(frontView(cells, fp, H), frontView(target, fp, H)) &&
    sameGrid(sideView(cells, fp, H), sideView(target, fp, H))
  );
}

// 판 밖 칸이 있는 조각이 하나라도 있으면 'incomplete'(아직 다 안 놓음),
// 모두 판 위면 지금 단서와 맞는지로 'solved' / 'mismatch'.
export function judge(pieces, target, level) {
  const fp = footprint(target);
  const all = [];
  for (const p of pieces) {
    const cells = worldCells(p);
    if (!onFootprint(cells, fp)) return 'incomplete';
    all.push(...cells);
  }
  return matchesClue(all, target, level) ? 'solved' : 'mismatch';
}
