// 1단계 단서(목표 모양 반투명 표시)에서 쓰는 순수 계산: 놓인 칸 중 목표 밖에 있는 칸, 이미 채워진 목표 칸.
import { worldCells } from './board.js';
import { key } from './pieces.js';

// pieces: [{cells, pos:[x,y,z]}], target: [[x,y,z],...] (월드 칸).
// exceptIndex 번째 조각(끄는 중 띄운 조각)은 없는 것으로 본다.
// 판 위에 놓였다고 보는 조각 = 칸 하나라도 목표의 바닥 모양(x,z 기둥) 위에 있는 조각.
// 판 둘레 대기 자리에 있는 조각은 아직 놓지 않은 것이라 틀린 곳으로 세지 않는다.
// -> { wrongCells: 목표 밖 칸 키 Set, filledTargetCells: 조각이 이미 차지한 목표 칸 키 Set } (키는 "x,y,z")
export function cellStatus(pieces, target, exceptIndex = -1) {
  const targetKeys = new Set(target.map(key));
  const columns = new Set(target.map((c) => `${c[0]},${c[2]}`));
  const wrongCells = new Set();
  const filledTargetCells = new Set();
  pieces.forEach((p, i) => {
    if (i === exceptIndex) return;
    const cells = worldCells(p);
    const onBoard = cells.some((c) => columns.has(`${c[0]},${c[2]}`));
    for (const c of cells) {
      const k = key(c);
      if (targetKeys.has(k)) filledTargetCells.add(k);
      else if (onBoard) wrongCells.add(k);
    }
  });
  return { wrongCells, filledTargetCells };
}
