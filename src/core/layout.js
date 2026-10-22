// 작업대(반지름 6 원) 안 배치 규칙. 순수 함수만 둔다(React·브라우저 API 금지).
// 좌표: 칸 [x, y, z], y가 위, +z가 앞. 각도는 도(degree), 0 = +x, 90 = +z(앞).
import { dims, rotate, lieFlat, orientations, normalize, turn } from './pieces.js';
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

// 조각 하나(한 방향)가 작업대 안(fits)에 들어가는 모든 정수 위치를 목표 지점에 가까운 순으로.
// 금지 칸과 상관없으므로 탐색 전에 한 번만 구해 두고, 탐색 마디마다 금지 칸만 걸러 쓴다.
function allSpots(cells, center, goal) {
  const cols = [...new Set(cells.map((c) => `${c[0]},${c[2]}`))].map((k) => k.split(',').map(Number));
  const x0 = Math.floor(center.x - ISLAND_R) - 1;
  const x1 = Math.ceil(center.x + ISLAND_R) + 1;
  const z0 = Math.floor(center.z - ISLAND_R) - 1;
  const z1 = Math.ceil(center.z + ISLAND_R) + 1;
  const found = [];
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      if (!fits(cells, x, z, center)) continue;
      found.push({ x, z, dist: Math.hypot(x - goal[0], z - goal[1]), keys: cols.map(([cx, cz]) => `${x + cx},${z + cz}`) });
    }
  }
  found.sort((a, b) => a.dist - b.dist); // 안정 정렬: 같은 거리면 x, z 작은 쪽 먼저
  return { cols, all: found };
}

// 금지 칸(blocked: "x,z" -> 막은 수)을 피한 후보 자리 중 앞에서부터 limit 개
function spotsFor(cached, blocked, limit) {
  const spots = [];
  for (const s of cached.all) {
    if (s.keys.some((k) => blocked.get(k) > 0)) continue;
    spots.push(s);
    if (spots.length >= limit) break;
  }
  return spots;
}

const NODE_LIMIT = 20000;
const SPOTS_PER_VARIANT = 6;
const VARIANT_PENALTY = 0.75; // 정해진 눕힌 방향을 조금 더 선호

// 조각들의 시작 자리. 각 조각을 rng 로 1~3번 무작위로 돌린 뒤 눕히고(앞·뒤 각도는 긴 변이 x,
// 옆 각도는 z), 작업대 안(fits)에서 판 칸+둘레 1칸, 이미 놓은 조각+둘레 1칸을 피하는 정수 위치 중
// 목표 각도 지점에 가장 가까운 곳을 고른다. 목표 지점 근처에 없으면 창 전체에서 가장 가까운 곳을
// 찾는다. 앞 조각이 자리를 다 막아 뒤 조각이 들어갈 곳이 없으면(5x4 판 등) 되돌아가서 앞 조각의
// 다음 후보 자리를 시도한다. 후보는 모든 눕힌 방향을 섞어 (거리 + 방향 순서 벌점 0.75) 순이다.
// avoid(선택): "x,z" 칸 집합. 화면 UI(단서 카드 등) 아래로 가려지는 칸이라 조각을 두지 않는다. 그렇게
// 하면 자리가 없을 때는 avoid 없이 다시 찾는다.
// 끝내 안 되면 칸 수를 담은 Error 를 던진다. -> [{cells, x, z}] (y 는 dropY 로 따로 구한다)
export function placeStarts(pieceCellsList, fp, rng, angles = startAngles(pieceCellsList.length), avoid = null) {
  const center = boardCenter(fp);
  const n = pieceCellsList.length;
  const base = new Set(avoid || []);
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
    // 뒤쪽(270도·225도 등) 조각은 화면에서 판·목표 모양 위로 덜 겹치게 목표 지점을 작업대 끝(반지름 R)에 둔다.
    // 들어가는 자리 중 그쪽으로 가장 먼 곳이 골라진다(R16a).
    const back = Math.sin(rad) < -0.7;
    const r = back ? ISLAND_R : START_R;
    const spots = list.map((o) => {
      const [w, , d] = dims(o);
      return allSpots(o, center, [center.x + r * Math.cos(rad) - w / 2, center.z + r * Math.sin(rad) - d / 2]);
    });
    return { back, list, spots };
  });

  // 처음 찾은 배치(각 조각이 가장 가까운 자리)에서 멈추지 않고, 노드 한도 안에서 비용 합
  // (목표까지 거리 + 방향 벌점)이 더 작은 배치를 계속 찾는다(가지치기). 조각이 많아 자리가
  // 빠듯할 때 한 조각이 엉뚱한 쪽으로 밀려나는 일을 줄인다.
  // 금지 칸은 셈(Map)으로 두고 조각을 놓을 때 더했다가 되돌아올 때 뺀다(마디마다 집합을 복사하지 않는다).
  const blocked = new Map();
  const ringKeys = (cols) => {
    const out = [];
    for (const [cx, cz] of cols) {
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) out.push(`${cx + a},${cz + b}`);
    }
    return out;
  };
  let nodes = 0;
  const chosen = [];
  let best = null;
  let bestCost = Infinity;
  function place(i, cost = 0) {
    if (cost >= bestCost) return false;
    if (i === n) {
      best = chosen.slice(0, n);
      bestCost = cost;
      return false; // 계속 찾는다
    }
    const { back, list, spots } = variants[i];
    // 모든 눕힌 방향의 후보 자리를 한데 모아 (목표까지 거리 + 방향 순서 벌점) 순으로 시도한다.
    // 첫 방향이 목표 근처에 들어가지 못하면 다른 방향이 목표 자리에 놓인다(멀리 밀려나지 않게).
    const cands = [];
    for (let v = 0; v < list.length; v++) {
      const { cols } = spots[v];
      for (const s of spotsFor(spots[v], blocked, SPOTS_PER_VARIANT)) {
        cands.push({ cells: list[v], cols, x: s.x, z: s.z, cost: s.dist + VARIANT_PENALTY * v });
      }
    }
    cands.sort((a, b) => a.cost - b.cost); // 안정 정렬: 같으면 앞 방향·가까운 자리 먼저
    for (const c of cands) {
      // 뒤 조각의 거리·벌점은 합계에 넣지 않는다(다른 조각 자리를 뒤 조각 때문에 다시 찾지 않게). 뒤 조각은
      // 남은 자리 중 가장 좋은 곳 하나를 고른다.
      const add = back ? 0 : c.cost;
      if (cost + add >= bestCost) break; // 정렬돼 있으니 뒤는 더 비싸다
      if (++nodes > NODE_LIMIT) return false;
      const keys = ringKeys(c.cols.map(([cx, cz]) => [c.x + cx, c.z + cz]));
      for (const k of keys) blocked.set(k, (blocked.get(k) || 0) + 1);
      chosen[i] = { cells: c.cells, x: c.x, z: c.z };
      place(i + 1, cost + add);
      for (const k of keys) blocked.set(k, blocked.get(k) - 1);
    }
    return false;
  }

  const search = (start) => {
    blocked.clear();
    for (const k of start) blocked.set(k, 1);
    nodes = 0;
    place(0);
  };
  search(withLabel);
  if (!best) search(base);
  if (!best && avoid && avoid.size) return placeStarts(pieceCellsList, fp, rng, angles);
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

// ---------- 끌기 ----------
// 예전 끌기는 바닥(y=0) 평면에서 손가락 아래 점을 따라가, 쌓인 조각 윗면을 가리켜도 조각이 그 뒤 바닥으로
// 가거나(카메라가 약 35도로 내려다봐 한 층 높을 때마다 1.4칸씩 어긋남) 지나가는 조각 위로 뛰어올랐다.
// 이제 잡은 점(조각 위의 점)이 손가락 광선 위에 오는 자리를 높이마다 구해, 그 자리에 떨어뜨린 높이가 그 높이와
// 같은(실제로 거기 놓일 수 있는) 자리만 후보로 둔다. 후보 중 칸에 맞춘 잡은 점이 손가락 점에 가장 가까운 자리
// (화면에서 손가락 바로 아래로 보이는 자리, 같으면 높은 쪽)로 간다. 그래서 윗면을 가리키면 그 위에, 벽 뒤 바닥을
// 가리키면 그 바닥에 놓이고, 잡자마자 다른 높이로 튀지 않는다(잡은 자리는 오차 0).
// 후보가 없으면(손가락이 벽 앞면을 가리킴) null 을 돌려주고 조각은 그 자리에 둔다.
// pointAt(y): 손가락 광선이 판 좌표 높이 y 의 수평면과 만나는 점 {x, z}(없으면 null).
// grab: {off: [ox, oz], gy} 잡은 점 = (pos.x + ox, pos.y + gy, pos.z + oz).
export function dragStep(piece, pointAt, grab, pieces, center) {
  const occ = occupiedSet(without(pieces, piece), -1);
  let top = -1;
  for (const k of occ) top = Math.max(top, Number(k.split(',')[1]));
  let best = null;
  let bestE = Infinity;
  for (let h = top + 1; h >= 0; h--) {
    const f = pointAt(h + grab.gy);
    if (!f) continue;
    const [x, z] = clampInside(piece.cells, Math.round(f.x - grab.off[0]), Math.round(f.z - grab.off[1]), center);
    if (dropY(piece.cells, x, z, occ) !== h) continue;
    const e = Math.hypot(x + grab.off[0] - f.x, z + grab.off[1] - f.z);
    if (e < bestE - 1e-9) { best = { cells: piece.cells, pos: [x, h, z] }; bestE = e; }
  }
  return best;
}

// ---------- 돌리기 ----------
// 예전에는 최소 모서리(pos x, z)를 고정하고 돌린 뒤 위에서 떨어뜨려, 돌린 모양이 옆 조각과 겹치면 그 위로
// 올라탔다(2026-10-22 감사: 판 위 회전 4.5%, 판 밖 회전 3.2%가 판 칸으로 들어감). 이제는
// 1) 조각의 가운데(회전 중심, 피벗)를 축으로 제자리에서 돌리고,
// 2) 같은 높이(돌리기 전 바닥 높이 y0) 이하로 놓이는 가장 가까운 빈 자리(반경 ROT_R 칸, 작업대 안)를 찾고,
// 3) 판 밖 조각이면 판 칸으로 들어가지 않는 자리만 쓴다.
// 같은 높이 이하 자리가 없을 때만 가장 낮게 놓이는 가까운 자리(예전처럼 위에 얹힘)를 쓴다.
const ROT_R = 2;
const ROT_OFFSETS = (() => {
  const out = [];
  for (let dx = -ROT_R; dx <= ROT_R; dx++) for (let dz = -ROT_R; dz <= ROT_R; dz++) out.push([dx, dz]);
  // 가까운 순. 같은 거리면 뒤(−z)·왼쪽(−x)보다 앞·오른쪽을 먼저(정해진 순서면 된다)
  return out.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || b[1] - a[1] || b[0] - a[0]);
})();

// 피벗: 조각 칸 좌표(pos 기준) 위의 점. 세 좌표가 모두 정수(칸 모서리)이거나 모두 반정수(칸 가운데)여야
// 어느 축으로 돌려도 칸이 칸으로 간다. 처음에는 조각을 감싼 상자의 가운데에 가장 가까운 그런 점을 쓰고,
// 돌린 결과에 피벗을 같이 실어(pivot) 다음 돌리기도 같은 점을 축으로 한다. 그래서 네 번 돌리면 제자리다.
const isPivot = (p) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite)
  && (p.every((v) => Number.isInteger(v)) || p.every((v) => Number.isInteger(v - 0.5)));
export function defaultPivot(cells) {
  const d = dims(cells);
  const half = d.filter((n) => n % 2 === 1).length >= 2; // 길이가 홀수인 축이 많으면 칸 가운데, 아니면 모서리
  return d.map((n) => {
    const c = n / 2;
    const isHalf = n % 2 === 1;
    return isHalf === half ? c : c - 0.5;
  });
}

// piece 의 칸을 피벗 둘레로 돌린 결과 {cells(정규화), x, y, z(돌린 뒤 최소 모서리, 세계 칸), pivot(새 pos 기준)}
function turnAbout(piece, axis) {
  const base = normalize(piece.cells);
  const shift = [0, 1, 2].map((k) => Math.min(...piece.cells.map((c) => c[k]))); // 정규화로 옮긴 만큼
  const pv = isPivot(piece.pivot) ? piece.pivot.map((v, k) => v - shift[k]) : defaultPivot(base);
  const moved = base.map((c) => {
    const r = turn([c[0] + 0.5 - pv[0], c[1] + 0.5 - pv[1], c[2] + 0.5 - pv[2]], axis);
    return [r[0] + pv[0] - 0.5, r[1] + pv[1] - 0.5, r[2] + pv[2] - 0.5];
  });
  const min = [0, 1, 2].map((k) => Math.min(...moved.map((c) => c[k])));
  const cells = normalize(moved);
  return {
    cells,
    x: piece.pos[0] + shift[0] + min[0],
    z: piece.pos[2] + shift[2] + min[2],
    pivot: pv.map((v, k) => v - min[k] + 0), // + 0: -0 을 0 으로
  };
}

// 조각을 axis('x'|'y'|'z')로 90도 돌린다(위 규칙). 새 객체 {cells, pos, pivot}를 돌려준다.
// board(선택): 판 칸 "x,z" 집합. 주면 판 밖에 있던 조각은 판 칸으로 들어가지 않는다.
// piece 제외 규칙은 movePiece 와 같다.
export function rotatePiece(piece, axis, pieces, center, board = null) {
  const others = without(pieces, piece);
  const occ = occupiedSet(others, -1);
  const t = turnAbout(piece, axis);
  const y0 = piece.pos[1];
  const touchesBoard = (cells, x, z) => cells.some((c) => board.has(`${x + c[0]},${z + c[2]}`));
  const keepOff = !!board && !touchesBoard(piece.cells, piece.pos[0], piece.pos[2]);
  let fallback = null;
  for (const [dx, dz] of ROT_OFFSETS) {
    const x = t.x + dx;
    const z = t.z + dz;
    if (!fits(t.cells, x, z, center)) continue;
    if (keepOff && touchesBoard(t.cells, x, z)) continue;
    const y = dropY(t.cells, x, z, occ);
    if (y <= y0) return { cells: t.cells, pos: [x, y, z], pivot: t.pivot };
    if (!fallback || y < fallback.pos[1]) fallback = { cells: t.cells, pos: [x, y, z], pivot: t.pivot };
  }
  if (fallback) return fallback;
  // 반경 안에 작업대 안 자리가 없다(작업대 가장자리에서 길게 세움 등): 예전처럼 끌어당겨 떨어뜨린다
  return { ...settle(t.cells, t.x, t.z, others, center), pivot: t.pivot };
}
