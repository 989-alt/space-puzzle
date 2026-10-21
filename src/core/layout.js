// 작업대(반지름 6 원) 안 배치 규칙. 순수 함수만 둔다(React·브라우저 API 금지).
// 좌표: 칸 [x, y, z], y가 위, +z가 앞. 각도는 도(degree), 0 = +x, 90 = +z(앞).
import { dims, rotate, lieFlat, orientations } from './pieces.js';
import { worldCells, occupiedSet, dropY } from './board.js';

export const ISLAND_R = 6; // 작업대 반지름
export const START_R = 3.9; // 시작 위치가 놓일 판 중심에서의 거리
const MARGIN = 0.15; // 가장자리 여유
const CORNERS = [[0, 0], [1, 0], [0, 1], [1, 1]];

// 판(바닥) 중심. 판은 x 0..w, z 0..d 칸 영역이다.
export const boardCenter = (fp) => ({ x: fp.w / 2, z: fp.d / 2 });

// 조각이 위치 (x, z)에 있을 때 모든 칸의 네 모서리가 중심에서 r − 0.15 이내인가.
export function fits(cells, x, z, center, r = ISLAND_R) {
  const lim = r - MARGIN;
  return cells.every((c) =>
    CORNERS.every(([u, v]) => Math.hypot(x + c[0] + u - center.x, z + c[2] + v - center.z) <= lim));
}

// 작업대 밖이면 중심 쪽으로 한 칸씩(큰 쪽 축부터) 최대 20번 끌어당긴다. -> [x, z]
// 아주 멀리 놓인 값(예: 드래그가 화면 밖)도 20번 안에 들어오도록, 조각 중심이 작업대 반지름
// 밖이면 먼저 그 경계로 한 번에 당긴 뒤 한 칸씩 움직인다.
export function clampInside(cells, x, z, center) {
  const [w, , d] = dims(cells);
  let px = x;
  let pz = z;
  const dist = Math.hypot(px + w / 2 - center.x, pz + d / 2 - center.z);
  if (dist > ISLAND_R) {
    const k = ISLAND_R / dist;
    px = Math.round(center.x + (px + w / 2 - center.x) * k - w / 2);
    pz = Math.round(center.z + (pz + d / 2 - center.z) * k - d / 2);
  }
  for (let n = 0; n < 20 && !fits(cells, px, pz, center); n++) {
    const dx = center.x - (px + w / 2);
    const dz = center.z - (pz + d / 2);
    if (Math.abs(dx) >= Math.abs(dz)) px += Math.sign(dx);
    else pz += Math.sign(dz);
  }
  return [px, pz];
}

// 시작 각도(앞이 90도, 뒤가 270도). 앞(90도)은 "앞" 표시 통로라 비운다.
// 판 뒤에 둔 조각은 카메라 시점 때문에 화면에서 목표 모양 위로 겹쳐 보이므로, 후보 각도 중 겹치는
// 문제가 가장 적은 배치를 실측해 골랐다(R17, 160문제 × 시드 3개).
// 3개: 왼·오른·오른앞, 4개: 왼·왼앞·오른앞·오른, 5개: 왼·왼앞·오른앞·오른·왼뒤.
export function startAngles(n) {
  if (n === 3) return [180, 0, 45];
  if (n === 4) return [180, 135, 45, 0];
  if (n === 5) return [180, 135, 45, 0, 225];
  // 그 밖의 개수는 왼쪽(180)에서 오른쪽(0)까지 앞쪽 반원에 고르게 둔다.
  if (n === 1) return [90];
  return Array.from({ length: n }, (_, i) => 180 - (180 * i) / (n - 1));
}

const AXES = ['y', 'x', 'z'];

// 한 칸 둘레(8방향)까지 포함해 금지 칸 집합에 넣는다.
function addWithRing(set, cols) {
  for (const [cx, cz] of cols) {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) set.add(`${cx + a},${cz + b}`);
  }
}

// 조각 하나의 후보 자리를 목표 지점에 가까운 순으로 돌려준다. 금지 칸·작업대 경계를 지킨 정수 위치만.
function spotsFor(cells, forbidden, center, goal, limit) {
  const cols = [...new Set(cells.map((c) => `${c[0]},${c[2]}`))].map((k) => k.split(',').map(Number));
  const x0 = Math.floor(center.x - ISLAND_R) - 1;
  const x1 = Math.ceil(center.x + ISLAND_R) + 1;
  const z0 = Math.floor(center.z - ISLAND_R) - 1;
  const z1 = Math.ceil(center.z + ISLAND_R) + 1;
  const found = [];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!fits(cells, x, z, center)) continue;
      if (cols.some(([cx, cz]) => forbidden.has(`${x + cx},${z + cz}`))) continue;
      found.push({ x, z, dist: Math.hypot(x - goal[0], z - goal[1]) });
    }
  }
  found.sort((a, b) => a.dist - b.dist); // 안정 정렬: 같은 거리면 x, z 작은 쪽 먼저
  return { cols, spots: found.slice(0, limit) };
}

const NODE_LIMIT = 20000;
const SPOTS_PER_VARIANT = 6;
const VARIANT_PENALTY = 0.75; // 정해진 눕힌 방향을 조금 더 선호

// 조각들의 시작 자리. 각 조각을 rng 로 1~3번 무작위로 돌린 뒤 눕히고(앞·뒤 각도는 긴 변이 x,
// 옆 각도는 z), 작업대 안(fits)에서 판 칸+둘레 1칸, 이미 놓은 조각+둘레 1칸을 피하는 정수 위치 중
// 목표 각도 지점에 가장 가까운 곳을 고른다. 목표 지점 근처에 없으면 창 전체에서 가장 가까운 곳을
// 찾는다. 앞 조각이 자리를 다 막아 뒤 조각이 들어갈 곳이 없으면(5x4 판 등) 되돌아가서 앞 조각의
// 다음 후보 자리를 시도한다. 후보는 모든 눕힌 방향을 섞어 (거리 + 방향 순서 벌점 0.75) 순이다.
// 끝내 안 되면 칸 수를 담은 Error 를 던진다. -> [{cells, x, z}] (y 는 dropY 로 따로 구한다)
export function placeStarts(pieceCellsList, fp, rng, angles = startAngles(pieceCellsList.length)) {
  const center = boardCenter(fp);
  const n = pieceCellsList.length;
  const base = new Set();
  addWithRing(base, [...fp.cells].map((k) => k.split(',').map(Number)));
  // "앞" 표시 바로 앞 통로(둘레 다음 줄부터 작업대 끝까지, 가운데 2~3열)도 비운다.
  // 앞 조각이 표시를 가리지 않고 왼앞·오른앞으로 비켜 놓인다. 통로까지 비우면 자리가 없는
  // 문제는 통로 없이 다시 찾는다.
  const withLabel = new Set(base);
  const zEnd = Math.ceil(center.z + ISLAND_R) + 1;
  for (let x = Math.floor(fp.w / 2) - 1; x <= Math.ceil(fp.w / 2); x++) {
    for (let z = fp.d + 1; z <= zEnd; z++) withLabel.add(`${x},${z}`);
  }

  // 각 조각의 방향 후보: 정해진 눕힌 방향 -> 긴 변을 반대 축으로 -> 같은 높이의 나머지 방향
  const variants = pieceCellsList.map((src, i) => {
    let cells = src;
    const turns = 1 + Math.floor(rng() * 3);
    for (let t = 0; t < turns; t++) cells = rotate(cells, AXES[Math.floor(rng() * 3)]);
    const rad = (angles[i] * Math.PI) / 180;
    const frontBack = Math.abs(Math.sin(rad)) > 0.7;
    const first = lieFlat(cells, frontBack ? 'x' : 'z');
    const second = lieFlat(cells, frontBack ? 'z' : 'x');
    const flatH = dims(first)[1]; // 눕힌 높이 그대로인 방향만(세워 두는 방향은 쓰지 않는다)
    const rest = orientations(cells).filter((o) => dims(o)[1] === flatH);
    const seen = new Set();
    const list = [];
    for (const o of [first, second, ...rest]) {
      const k = o.map((c) => c.join(',')).join(';');
      if (!seen.has(k)) { seen.add(k); list.push(o); }
    }
    return { rad, list };
  });

  // 처음 찾은 배치(각 조각이 가장 가까운 자리)에서 멈추지 않고, 노드 한도 안에서 비용 합
  // (목표까지 거리 + 방향 벌점)이 더 작은 배치를 계속 찾는다(가지치기). 조각이 많아 자리가
  // 빠듯할 때 한 조각이 엉뚱한 쪽으로 밀려나는 일을 줄인다.
  let nodes = 0;
  const chosen = [];
  let best = null;
  let bestCost = Infinity;
  function place(i, forbidden, cost = 0) {
    if (cost >= bestCost) return false;
    if (i === n) {
      best = chosen.slice(0, n);
      bestCost = cost;
      return false; // 계속 찾는다
    }
    const { rad, list } = variants[i];
    // 뒤쪽(270도·225도 등) 조각은 화면에서 판·목표 모양 위로 덜 겹치게 목표 지점을 작업대 끝(반지름 R)에 둔다.
    // 들어가는 자리 중 그쪽으로 가장 먼 곳이 골라진다(R16a).
    const back = Math.sin(rad) < -0.7;
    // 모든 눕힌 방향의 후보 자리를 한데 모아 (목표까지 거리 + 방향 순서 벌점) 순으로 시도한다.
    // 첫 방향이 목표 근처에 들어가지 못하면 다른 방향이 목표 자리에 놓인다(멀리 밀려나지 않게).
    const cands = [];
    for (let v = 0; v < list.length; v++) {
      const cells = list[v];
      const [w, , d] = dims(cells);
      const r = back ? ISLAND_R : START_R;
      const goal = [center.x + r * Math.cos(rad) - w / 2, center.z + r * Math.sin(rad) - d / 2];
      const { cols, spots } = spotsFor(cells, forbidden, center, goal, SPOTS_PER_VARIANT);
      for (const s of spots) cands.push({ cells, cols, x: s.x, z: s.z, cost: s.dist + VARIANT_PENALTY * v });
    }
    cands.sort((a, b) => a.cost - b.cost); // 안정 정렬: 같으면 앞 방향·가까운 자리 먼저
    for (const c of cands) {
      // 뒤 조각의 거리·벌점은 합계에 넣지 않는다(다른 조각 자리를 뒤 조각 때문에 다시 찾지 않게). 뒤 조각은
      // 남은 자리 중 가장 좋은 곳 하나를 고른다.
      const add = back ? 0 : c.cost;
      if (cost + add >= bestCost) break; // 정렬돼 있으니 뒤는 더 비싸다
      if (++nodes > NODE_LIMIT) return false;
      const next = new Set(forbidden);
      addWithRing(next, c.cols.map(([cx, cz]) => [c.x + cx, c.z + cz]));
      chosen[i] = { cells: c.cells, x: c.x, z: c.z };
      place(i + 1, next, cost + add);
    }
    return false;
  }

  place(0, withLabel);
  if (!best) {
    nodes = 0;
    place(0, base);
  }
  if (!best) {
    const cnt = pieceCellsList.map((c) => c.length).join('+');
    throw new Error(`작업대에 조각(${cnt}칸, 판 ${fp.w}x${fp.d})을 모두 놓을 자리가 없습니다`);
  }
  return best;
}

// others: 움직이는 조각 자신을 뺀 나머지. pieces 에 piece 자신이 (같은 객체로) 들어 있어도 된다.
const without = (pieces, piece) => pieces.filter((p) => p !== piece);

function settle(cells, x, z, others, center) {
  const [cx, cz] = clampInside(cells, x, z, center);
  const y = dropY(cells, cx, cz, occupiedSet(others, -1));
  return { cells, pos: [cx, y, cz] };
}

// 조각을 (x, z) 로 옮긴다(작업대 안으로 끌어당긴 뒤 위에서 떨어뜨린다). 새 객체를 돌려준다.
// pieces 에 piece 가 같은 객체(identity)로 들어 있으면 제외한다. 복사본을 넘기면 자기 자신과도 겹침을 계산한다.
export function movePiece(piece, x, z, pieces, center) {
  return settle(piece.cells, x, z, without(pieces, piece), center);
}

// 조각을 axis('x'|'y'|'z')로 90도 돌린다. 위치(최소 모서리)는 유지하고 작업대 안으로 끌어당긴 뒤
// 떨어뜨린다. 새 객체를 돌려준다. piece 제외 규칙은 movePiece 와 같다.
export function rotatePiece(piece, axis, pieces, center) {
  return settle(rotate(piece.cells, axis), piece.pos[0], piece.pos[2], without(pieces, piece), center);
}
