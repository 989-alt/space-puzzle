// 문제 은행 전수 감사(2026-10-22). 160문제가 실제 게임 조작으로 풀리는지, 단서가 3D 목표와 맞는지 검사한다.
//   node tools/audit-puzzles.mjs          -> 검사별 요약 표 + 실패 문제 목록
//   node tools/audit-puzzles.mjs --json   -> 전체 결과 JSON
// 게임 조작은 src/scene/input.js·src/main.js 가 부르는 core 함수(placeStarts·rotatePiece·movePiece·settleAll·judge)를
// 그 순서 그대로 불러 흉내 낸다. 단서 방향은 clues.js 를 쓰지 않고 3D 목표·카메라 투영에서 따로 다시 만든다.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from '#three';
import { key, normalize, rotate, orientations } from '../src/core/pieces.js';
import { worldCells, occupiedSet, dropY, settleAll } from '../src/core/board.js';
import { clueFor, footprint, hasOverhang, height } from '../src/core/clues.js';
import { judge } from '../src/core/judge.js';
import { solve } from '../src/core/solver.js';
import { boardCenter, placeStarts, movePiece, rotatePiece, dragStep, fits } from '../src/core/layout.js';
import { fitCamera } from '../src/scene/calibrate.js';
import { renderClue } from '../src/ui/clueCard.js';

const ROOT = new URL('../', import.meta.url);
export const SEEDS = [1, 2, 3, 4, 5];
export const SOLUTION_LIMIT = 50;

// ---------- 공통 ----------
export function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadBanks() {
  return [1, 2, 3, 4].flatMap((s) =>
    JSON.parse(readFileSync(new URL(`data/puzzles-s${s}.json`, ROOT), 'utf8')).map((p) => ({ ...p, file: s })));
}

const sameCells = (a, b) => normalize(a).map(key).join(';') === normalize(b).map(key).join(';');
const samePos = (a, b) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

function permutations(n) {
  const out = [];
  const rec = (cur, used) => {
    if (cur.length === n) { out.push(cur.slice()); return; }
    for (let i = 0; i < n; i++) {
      if (used[i]) continue;
      used[i] = true; cur.push(i);
      rec(cur, used);
      cur.pop(); used[i] = false;
    }
  };
  rec([], []);
  return out;
}
const PERMS = new Map();
const perms = (n) => { if (!PERMS.has(n)) PERMS.set(n, permutations(n)); return PERMS.get(n); };

function connected(cells, nbrs) {
  const set = new Set(cells.map(key));
  const seen = new Set([key(cells[0])]);
  const stack = [cells[0]];
  while (stack.length) {
    const c = stack.pop();
    for (const d of nbrs) {
      const k = key([c[0] + d[0], c[1] + d[1], c[2] + d[2]]);
      if (set.has(k) && !seen.has(k)) { seen.add(k); stack.push(k.split(',').map(Number)); }
    }
  }
  return seen.size === set.size;
}
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N4 = [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]];

// ---------- A. 데이터 ----------
// 스펙 4.3(조각 수 1~2단계 3개, 3단계 4개, 4단계 4~5개) + tests/bank.test.mjs 의 생성 규칙
export const RULES = {
  1: { pieces: [3, 3], cells: [10, 12], w: 4, d: 3 },
  2: { pieces: [3, 3], cells: [11, 12], w: 4, d: 3 },
  3: { pieces: [4, 4], cells: [13, 16], w: 5, d: 3 },
  4: { pieces: [4, 5], cells: [15, 19], w: 5, d: 4 },
};

export function checkData(p, seenIds = new Set()) {
  const bad = [];
  const s = p.file;
  if (p.stage !== s) bad.push(`stage ${p.stage} in file s${s}`);
  if (!new RegExp(`^s${s}-\\d{3}$`).test(p.id)) bad.push(`id pattern ${p.id}`);
  if (seenIds.has(p.id)) bad.push(`duplicate id ${p.id}`);
  seenIds.add(p.id);
  const t = p.target;
  if (new Set(t.map(key)).size !== t.length) bad.push('target duplicate cells');
  if (t.some((c) => c.length !== 3 || c.some((v) => !Number.isInteger(v)))) bad.push('target non-integer cell');
  if (t.some((c) => c[1] < 0)) bad.push('target below floor');
  if (hasOverhang(t)) bad.push('target overhang');
  if (height(t) > 2) bad.push(`target height ${height(t)}`);
  if (Math.min(...t.map((c) => c[0])) !== 0 || Math.min(...t.map((c) => c[2])) !== 0) bad.push('target not at origin');
  const floor = t.filter((c) => c[1] === 0);
  if (!floor.length || !connected(floor, N4)) bad.push('floor not 4-connected');
  const total = p.pieces.reduce((n, pc) => n + pc.length, 0);
  if (total !== t.length) bad.push(`piece cells ${total} != target ${t.length}`);
  p.pieces.forEach((pc, i) => {
    if (!connected(pc, N6)) bad.push(`piece ${i} not connected`);
    if (JSON.stringify(pc) !== JSON.stringify(normalize(pc))) bad.push(`piece ${i} not normalized`);
    if (new Set(pc.map(key)).size !== pc.length) bad.push(`piece ${i} duplicate cells`);
  });
  const r = RULES[s];
  const fp = footprint(t);
  if (p.pieces.length < r.pieces[0] || p.pieces.length > r.pieces[1]) bad.push(`piece count ${p.pieces.length}`);
  if (t.length < r.cells[0] || t.length > r.cells[1]) bad.push(`cell count ${t.length}`);
  if (fp.w > r.w || fp.d > r.d) bad.push(`footprint ${fp.w}x${fp.d}`);
  // 판 칸이 모두 작업대 안에 있는가(판에 놓인 조각이 clampInside 로 밀려나지 않는가)
  const center = boardCenter(fp);
  for (const k of fp.cells) {
    const [x, z] = k.split(',').map(Number);
    if (!fits([[0, 0, 0]], x, z, center)) bad.push(`board cell ${k} outside island`);
  }
  if (!Number.isInteger(p.solutions) || p.solutions < 1) bad.push(`solutions field ${p.solutions}`);
  return bad;
}

// ---------- 해답·낙하 순서 ----------
const solCache = new Map();
export function solutionsOf(p) {
  if (!solCache.has(p.id)) solCache.set(p.id, solve(p.target, p.pieces, { limit: SOLUTION_LIMIT }).solutions);
  return solCache.get(p.id);
}

// solver 해답의 i 번째 배치는 p.pieces[i] 의 한 방향이다(같은 모양 조각끼리 맞바꾼 것도 포함).
// 낙하 순서: 순서대로 dropY 로 떨어뜨렸을 때 모두 제자리(y)에 놓이는 순열.
export function validOrders(sol) {
  const ok = [];
  for (const perm of perms(sol.length)) {
    const occ = new Set();
    let good = true;
    for (const i of perm) {
      const s = sol[i];
      if (dropY(s.cells, s.pos[0], s.pos[2], occ) !== s.pos[1]) { good = false; break; }
      for (const c of worldCells(s)) occ.add(key(c));
    }
    if (good) ok.push(perm);
  }
  return ok;
}

// ---------- B. 게임 조작 흉내 ----------
// main.js startPieces 와 같다(avoid 는 화면 UI 크기가 필요해 null).
export function startState(p, seed) {
  const fp = footprint(p.target);
  const starts = placeStarts(p.pieces, fp, mulberry32(seed));
  const out = [];
  for (const s of starts) {
    const y = dropY(s.cells, s.x, s.z, occupiedSet(out, -1));
    out.push({ cells: s.cells, pos: [s.x, y, s.z] });
  }
  return out;
}

// input.js onRingClick: rotatePiece -> setPiece -> settle()
function uiRotate(pieces, i, axis, center, board) {
  const ps = pieces.slice();
  ps[i] = rotatePiece(pieces[i], axis, pieces, center, board);
  return settleAll(ps);
}
// input.js land: 마지막 칸에서 movePiece 다시 -> settle()
function uiLand(pieces, i, center) {
  const ps = pieces.slice();
  const p = pieces[i];
  ps[i] = movePiece(p, p.pos[0], p.pos[2], pieces, center);
  return settleAll(ps);
}
// 끌기 한 번(input.js onDown·dragTo·land): 게임 카메라(회전판 0)로 조각 윗면 한 점을 잡고, 그 점이 목표 자리에
// 올 화면 점까지 손가락을 곧게(약 12px 마다) 옮긴다. 걸음마다 dragStep(null 이면 그대로) -> settleAll(except i),
// 떼면 movePiece(같은 자리) -> settleAll. direct 면 바로 마지막 화면 점으로.
// DRAG_MODE=old 이면 예전 끌기(바닥 평면)로 흉내 낸다(고치기 전과 비교용).
const DRAG_MODE = process.env.DRAG_MODE || 'new';
const rayc = new THREE.Raycaster();
const ndcV = new THREE.Vector2();
const planeV = new THREE.Vector3();
function screenOf(x, y, z, center) {
  const v = new THREE.Vector3(x - center.x, y, z - center.z).project(getGameCam());
  return [((v.x + 1) / 2) * W, ((1 - v.y) / 2) * H];
}
function fingerAt([sx, sy], center) {
  ndcV.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
  rayc.setFromCamera(ndcV, getGameCam());
  const ray = rayc.ray.clone();
  return (y) => {
    const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), planeV);
    return hit ? { x: hit.x + center.x, z: hit.z + center.z } : null;
  };
}
// 잡는 점: 가장 높은 쌓기나무 중 조각 가운데에 가까운 것의 윗면 가운데(조각 기준)
function grabOf(cells) {
  const top = Math.max(...cells.map((c) => c[1]));
  const m = [0, 2].map((k) => cells.reduce((s, c) => s + c[k], 0) / cells.length);
  const c = cells.filter((q) => q[1] === top)
    .reduce((b, q) => (Math.hypot(q[0] - m[0], q[2] - m[1]) < Math.hypot(b[0] - m[0], b[2] - m[1]) ? q : b));
  return { off: [c[0] + 0.5, c[2] + 0.5], gy: c[1] + 1 };
}
function uiDrag(pieces, i, goal, center, direct = false) {
  const p0 = pieces[i];
  const g = grabOf(p0.cells);
  const a = screenOf(p0.pos[0] + g.off[0], p0.pos[1] + g.gy, p0.pos[2] + g.off[1], center);
  const b = screenOf(goal[0] + g.off[0], goal[1] + g.gy, goal[2] + g.off[1], center);
  const n = direct ? 1 : Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 12));
  let ps = pieces;
  if (DRAG_MODE === 'old') { // 예전 끌기(바닥 평면 점 + 누른 곳 offset, movePiece) 비교용
    const f0 = fingerAt(a, center)(0);
    const off = [f0.x - p0.pos[0], f0.z - p0.pos[2]];
    for (let k = 1; k <= n; k++) {
      const f = fingerAt([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], center)(0);
      const q = ps.slice();
      q[i] = movePiece(ps[i], Math.round(f.x - off[0]), Math.round(f.z - off[1]), ps, center);
      ps = settleAll(q, i);
    }
    return uiLand(ps, i, center);
  }
  for (let k = 1; k <= n; k++) {
    const f = fingerAt([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], center);
    const next = dragStep(ps[i], f, g, ps, center);
    if (!next) continue;
    const q = ps.slice();
    q[i] = next;
    ps = settleAll(q, i);
  }
  return uiLand(ps, i, center);
}

const AXES = ['y', 'x', 'z'];
// 링 버튼(y 돌리기, x 세우기, z 뒤집기)으로 from 방향에서 to 방향까지 가장 짧은 누름 순서. 없으면 null.
export function rotationPath(from, to) {
  const goal = normalize(to).map(key).join(';');
  const start = normalize(from);
  const sig = (c) => c.map(key).join(';');
  if (sig(start) === goal) return [];
  const prev = new Map([[sig(start), null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    for (const a of AXES) {
      const nx = rotate(cur, a);
      const s = sig(nx);
      if (prev.has(s)) continue;
      prev.set(s, [sig(cur), a]);
      if (s === goal) {
        const path = [];
        for (let k = s; prev.get(k); k = prev.get(k)[0]) path.unshift(prev.get(k)[1]);
        return path;
      }
      queue.push(nx);
    }
  }
  return null;
}

// 한 해답·한 순서로 실제 조작을 흉내 낸다.
// variant 'rotateFirst': 시작 자리에서 링으로 돌린 뒤 끌어 놓는다.
// variant 'moveFirst' : 먼저 목표 칸으로 끌어 놓고, 판 위에서 돌린 뒤, 다시 목표 칸으로 끈다.
// 결과 { ok, step, reason, pieces }
export function playOrder(p, sol, order, startPieces, { variant = 'rotateFirst', direct = false } = {}) {
  const fp = footprint(p.target);
  const center = boardCenter(fp);
  let ps = startPieces.map((q) => ({ cells: q.cells, pos: [...q.pos] }));
  const placed = [];
  const stats = { rotations: 0, hops: 0, hopsOnBoard: 0, onBoard: 0, aside: 0, far: 0, floating: 0 };
  const rot = (a, i) => {
    const before = worldCells(ps[i]);
    const y0 = ps[i].pos[1];
    // 다른 조각이 없을 때 돌아갈 제자리(같은 작업대)
    const alone = rotatePiece(ps[i], a, [ps[i]], center);
    ps = uiRotate(ps, i, a, center, fp.cells);
    stats.rotations++;
    // 다른 조각 때문에 제자리에서 옆으로 비켰는가, 그중 한 칸 넘게 비켰는가
    const d = Math.hypot(ps[i].pos[0] - alone.pos[0], ps[i].pos[2] - alone.pos[2]);
    if (d > 0) stats.aside++;
    if (d > 1) stats.far++;
    // 떠 있는 조각: 바닥(y=0)이 아닌데 바로 아래에 받치는 쌓기나무가 하나도 없음
    ps.forEach((q, j) => {
      if (q.pos[1] === 0) return;
      const occ = occupiedSet(ps, j);
      if (!worldCells(q).some((c) => occ.has(key([c[0], c[1] - 1, c[2]])))) stats.floating++;
    });
    const was = before.some((c) => fp.cells.has(`${c[0]},${c[2]}`));
    if (!was && worldCells(ps[i]).some((c) => fp.cells.has(`${c[0]},${c[2]}`))) stats.onBoard++;
    // 돌린 조각이 다른 조각 위로 올라탔는가(돌리기 전보다 높아짐), 그중 판 칸 위로 올라탔는가
    if (ps[i].pos[1] > y0) {
      stats.hops++;
      if (worldCells(ps[i]).some((c) => fp.cells.has(`${c[0]},${c[2]}`))) stats.hopsOnBoard++;
    }
  };
  for (let step = 0; step < order.length; step++) {
    const i = order[step];
    const goal = sol[i];
    const path = rotationPath(ps[i].cells, goal.cells);
    if (!path) return { ok: false, step, reason: `piece ${i}: orientation unreachable by ring buttons`, pieces: ps, stats };
    if (variant === 'rotateFirst') {
      for (const a of path) rot(a, i);
      ps = uiDrag(ps, i, goal.pos, center, direct);
    } else {
      ps = uiDrag(ps, i, goal.pos, center, direct);
      for (const a of path) rot(a, i);
      ps = uiDrag(ps, i, goal.pos, center, direct);
    }
    const got = ps[i];
    if (!sameCells(got.cells, goal.cells)) {
      return { ok: false, step, reason: `piece ${i}: orientation ${JSON.stringify(got.cells)} != ${JSON.stringify(goal.cells)}`, pieces: ps };
    }
    if (!samePos(got.pos, goal.pos)) {
      return { ok: false, step, reason: `piece ${i}: landed at ${got.pos} instead of ${goal.pos}`, pieces: ps };
    }
    for (const j of placed) {
      if (!samePos(ps[j].pos, sol[j].pos) || !sameCells(ps[j].cells, sol[j].cells)) {
        return { ok: false, step, reason: `piece ${j} (already placed) moved to ${ps[j].pos} while placing ${i}`, pieces: ps };
      }
    }
    placed.push(i);
    // 마지막 조각 전에는 'solved' 가 나오면 안 된다
    if (step < order.length - 1) {
      for (const L of [1, 2, 3, 4]) {
        if (judge(ps, p.target, L) === 'solved') return { ok: false, step, reason: `judge solved early at level ${L}`, pieces: ps };
      }
    }
  }
  const verdicts = [1, 2, 3, 4].map((L) => judge(ps, p.target, L));
  if (verdicts.some((v) => v !== 'solved')) return { ok: false, step: order.length, reason: `final judge ${verdicts.join('/')}`, pieces: ps, stats };
  return { ok: true, pieces: ps, stats };
}

export function checkStarts(p, seed) {
  const bad = [];
  let ps;
  try {
    ps = startState(p, seed);
  } catch (e) {
    return { bad: [`placeStarts threw (seed ${seed}): ${e.message}`], pieces: null };
  }
  const fp = footprint(p.target);
  const center = boardCenter(fp);
  const occ = new Set();
  ps.forEach((q, i) => {
    const w = worldCells(q);
    if (w.some((c) => fp.cells.has(`${c[0]},${c[2]}`))) bad.push(`seed ${seed}: start piece ${i} on board`);
    if (!fits(q.cells, q.pos[0], q.pos[2], center)) bad.push(`seed ${seed}: start piece ${i} outside island`);
    for (const c of w) {
      if (occ.has(key(c))) bad.push(`seed ${seed}: start pieces overlap`);
      occ.add(key(c));
    }
    if (q.pos[1] !== 0) bad.push(`seed ${seed}: start piece ${i} stacked (y=${q.pos[1]})`);
    const minH = Math.min(...orientations(q.cells).map((o) => Math.max(...o.map((c) => c[1])) + 1));
    if (Math.max(...q.cells.map((c) => c[1])) + 1 !== minH) bad.push(`seed ${seed}: start piece ${i} not lying flat`);
  });
  if (judge(ps, p.target, p.stage) !== 'incomplete') bad.push(`seed ${seed}: start judged ${judge(ps, p.target, p.stage)}`);
  return { bad, pieces: ps };
}

// B·C: 시드마다 시작 배치를 만들고, 해답마다 가능한 순서를 세며 실제 조작으로 끝까지 놓아 본다.
// full=true 면 시드 1에서 첫 해답의 모든 가능한 순서를 두 방식(rotateFirst·moveFirst)으로 놓아 보고,
// 가능하지 않은 순서 하나는 실제 조작에서도 실패하는지(solver 모형과 게임이 같은지) 본다.
export function checkReach(p, { seeds = SEEDS, full = true } = {}) {
  const sols = solutionsOf(p);
  const out = {
    id: p.id, solutions: sols.length, orderCounts: [], totalOrders: perms(p.pieces.length).length,
    startBad: [], fails: [], played: 0, modelMismatch: [],
    // [돌린 횟수, 다른 조각 위로 올라탄 횟수, 그중 판 위, 판 밖에서 돌렸는데 판 칸으로 들어간 횟수]
    hops: { rotateFirst: [0, 0, 0, 0, 0, 0, 0], moveFirst: [0, 0, 0, 0, 0, 0, 0] },
  };
  if (!sols.length) { out.fails.push('solver found no solution'); return out; }
  const orders = sols.map(validOrders);
  out.orderCounts = orders.map((o) => o.length);
  out.maxOrders = Math.max(...out.orderCounts);
  out.minOrders = Math.min(...out.orderCounts);
  if (out.maxOrders === 0) { out.fails.push('no valid drop order for any solution'); return out; }
  const si = out.orderCounts.findIndex((n) => n > 0);
  const sol = sols[si];
  for (const seed of seeds) {
    const st = checkStarts(p, seed);
    out.startBad.push(...st.bad);
    if (!st.pieces) { out.fails.push(`seed ${seed}: no start layout`); continue; }
    const list = full && seed === seeds[0] ? orders[si] : [orders[si][0]];
    for (const order of list) {
      for (const variant of ['rotateFirst', 'moveFirst']) {
        for (const direct of [false, true]) {
          if (direct && order !== list[0]) continue; // 바로 놓기는 첫 순서만
          const r = playOrder(p, sol, order, st.pieces, { variant, direct });
          out.played++;
          if (r.stats) {
            const h = out.hops[variant];
            h[0] += r.stats.rotations; h[1] += r.stats.hops; h[2] += r.stats.hopsOnBoard; h[3] += r.stats.onBoard;
            h[4] += r.stats.aside; h[5] += r.stats.far; h[6] += r.stats.floating;
          }
          if (!r.ok) out.fails.push(`seed ${seed} sol ${si} order [${order}] ${variant}${direct ? '/direct' : ''}: step ${r.step}: ${r.reason}`);
        }
      }
    }
    if (full && seed === seeds[0]) {
      const okSet = new Set(orders[si].map((o) => o.join()));
      const bad = perms(p.pieces.length).find((o) => !okSet.has(o.join()));
      if (bad) {
        const r = playOrder(p, sol, bad, st.pieces);
        if (r.ok) out.modelMismatch.push(`order [${bad}] invalid by dropY model but game reached solution`);
      }
    }
  }
  return out;
}

// ---------- D. 단서 ----------
// 화면 방향을 카메라 투영으로 정한다(clues.js 를 쓰지 않는다).
// 게임 카메라: fitCamera 로 맞춘 원근 카메라(판 중심이 원점, 회전판 0). 위 모양 = 이 카메라에서 본 행·열 순서.
// 앞 모양 = "앞" 표시 쪽(+z)에 선 사람이 보는 모양, 옆 모양 = 오른쪽(+x)에 선 사람이 보는 모양.
const W = 1600, H = 1000;
let gameCam = null;
function getGameCam() {
  if (!gameCam) {
    gameCam = new THREE.PerspectiveCamera(22, W / H, 0.1, 500);
    fitCamera(gameCam, W, H);
  }
  return gameCam;
}
function eyeCam(pos) {
  const c = new THREE.PerspectiveCamera(20, 1, 0.1, 1000);
  c.position.set(...pos);
  c.up.set(0, 1, 0);
  c.lookAt(0, 0.5, 0);
  c.updateProjectionMatrix();
  c.updateMatrixWorld();
  return c;
}
const proj = (cam, x, y, z) => {
  const v = new THREE.Vector3(x, y, z).project(cam);
  return { sx: ((v.x + 1) / 2) * W, sy: ((1 - v.y) / 2) * H };
};
// values 를 화면 좌표 f(value) 오름차순으로 줄 세운 순위 표 (value -> 0..n-1)
function rankBy(values, f) {
  const sorted = [...values].sort((a, b) => f(a) - f(b));
  return new Map(sorted.map((v, i) => [v, i]));
}
const range = (n) => Array.from({ length: n }, (_, i) => i);

// 3D 목표에서 화면에 보여야 할 단서 격자를 만든다(행 0 = 화면 위).
export function expectedScreenClues(target) {
  const t = target;
  const w = Math.max(...t.map((c) => c[0])) + 1;
  const d = Math.max(...t.map((c) => c[2])) + 1;
  const h = Math.max(...t.map((c) => c[1])) + 1;
  const cx = w / 2, cz = d / 2;
  const g = getGameCam();
  // 위에서 본 모양: 게임 카메라 화면에서 z 줄은 위→아래, x 칸은 왼→오
  const zRow = rankBy(range(d), (z) => proj(g, 0, 0, z + 0.5 - cz).sy);
  const xColTop = rankBy(range(w), (x) => proj(g, x + 0.5 - cx, 0, 0).sx);
  const front = eyeCam([0, 1, 60]);
  const xColFront = rankBy(range(w), (x) => proj(front, x + 0.5 - cx, 0.5, 0).sx);
  const yRowFront = rankBy(range(h), (y) => proj(front, 0, y + 0.5, 0).sy);
  const side = eyeCam([60, 1, 0]);
  const zColSide = rankBy(range(d), (z) => proj(side, 0, 0.5, z + 0.5 - cz).sx);
  const yRowSide = rankBy(range(h), (y) => proj(side, 0, y + 0.5, 0).sy);

  const blank = (r, c, v) => Array.from({ length: r }, () => Array(c).fill(v));
  const counts = blank(d, w, 0);
  const layers = range(h).map(() => blank(d, w, false));
  const top = blank(d, w, false);
  const frontG = blank(h, w, false);
  const sideG = blank(h, d, false);
  for (const [x, y, z] of t) {
    counts[zRow.get(z)][xColTop.get(x)] += 1;
    layers[y][zRow.get(z)][xColTop.get(x)] = true;
    top[zRow.get(z)][xColTop.get(x)] = true;
    frontG[yRowFront.get(y)][xColFront.get(x)] = true;
    sideG[yRowSide.get(y)][zColSide.get(z)] = true;
  }
  return {
    counts, layers, top, front: frontG, side: sideG,
    convention: {
      // 판 뒤(z=0)가 화면 위인지, +x 가 오른쪽인지, 옆 모양에서 앞(z 큰 쪽)이 왼쪽인지
      backOnTop: zRow.get(0) === 0,
      xRight: xColTop.get(0) === 0,
      sideFrontLeft: zColSide.get(d - 1) === 0,
      camOnFront: g.position.z > 0,
    },
  };
}

// clueCard.renderClue 를 작은 DOM 흉내로 돌려, 화면에 그려지는 칸 순서를 읽는다.
function fakeDocument() {
  const mk = (tag) => {
    const e = {
      tagName: tag, className: '', children: [], dataset: {}, _text: null,
      style: { setProperty(k, v) { this[k] = v; } },
      classList: { toggle() {}, add() {}, remove() {} },
      append(...xs) { for (const x of xs) this.children.push(typeof x === 'string' ? { text: x } : x); },
      replaceChildren(...xs) { this.children = []; this.append(...xs); },
      setAttribute() {},
      querySelector() { return null; },
      set textContent(v) { this._text = v; },
      get textContent() { return this._text; },
      set innerHTML(v) { this._html = v; },
    };
    return e;
  };
  return { createElement: mk };
}
function readGrid(g) {
  const m = /repeat\((\d+),/.exec(g.style.gridTemplateColumns || '');
  const cols = m ? Number(m[1]) : 0;
  const rows = [];
  for (let i = 0; i < g.children.length; i += cols) {
    rows.push(g.children.slice(i, i + cols).map((c) => ({ filled: c.className === 'f', text: c._text })));
  }
  return rows;
}
export function renderedClue(target, level) {
  const prev = globalThis.document;
  globalThis.document = fakeDocument();
  try {
    const lvl = document.createElement('div');
    const body = document.createElement('div');
    const card = { querySelector: (s) => (s === '.lvl' ? lvl : s === '.clue-body' ? body : null) };
    renderClue(card, clueFor(target, level));
    const parts = body.children;
    if (level === 2) {
      return { counts: readGrid(parts[0]).map((r) => r.map((c) => (c.filled ? Number(c.text) : 0))) };
    }
    if (level === 3) {
      const layers = [];
      const caps = [];
      for (let i = 0; i < parts.length; i += 2) {
        layers.push(readGrid(parts[i]).map((r) => r.map((c) => c.filled)));
        caps.push(parts[i + 1]._text);
      }
      return { layers, caps };
    }
    if (level === 4) {
      const out = {};
      for (const box of parts[0].children) {
        out[box.style.gridArea] = readGrid(box.children[0]).map((r) => r.map((c) => c.filled));
        out[`${box.style.gridArea}Cap`] = box.children[1]._text;
      }
      return out;
    }
    return {};
  } finally {
    if (prev === undefined) delete globalThis.document;
    else globalThis.document = prev;
  }
}

// 단서 카드의 위·앞·옆 배치(styles/screens.css 의 grid-template-areas)와 "앞" 표시 위치(world.js)를 읽는다.
export function staticConventions() {
  const css = readFileSync(new URL('styles/screens.css', ROOT), 'utf8');
  const world = readFileSync(new URL('src/scene/world.js', ROOT), 'utf8');
  const areas = /\.views\{[^}]*grid-template-areas:([^;}]*)/.exec(css)?.[1]?.trim() ?? '';
  return {
    viewsAreas: areas,
    viewsLayoutOk: areas === '"top ." "front side"',
    labelAtFront: /labelMesh\.position\.set\(center\.x,\s*[\d.]+,\s*fp\.d\s*\+\s*[\d.]+\)/.test(world),
  };
}

const J = JSON.stringify;
export function checkClues(p) {
  const bad = [];
  const exp = expectedScreenClues(p.target);
  for (const [k, v] of Object.entries(exp.convention)) if (!v) bad.push(`convention ${k} false`);
  // 1) clueFor 자료 = 3D 에서 따로 만든 화면 격자
  const c2 = clueFor(p.target, 2), c3 = clueFor(p.target, 3), c4 = clueFor(p.target, 4);
  if (J(c2.counts) !== J(exp.counts)) bad.push(`level2 data counts ${J(c2.counts)} != ${J(exp.counts)}`);
  if (J(c3.layers) !== J(exp.layers)) bad.push('level3 data layers differ');
  if (J(c4.top) !== J(exp.top)) bad.push(`level4 data top ${J(c4.top)} != ${J(exp.top)}`);
  if (J(c4.front) !== J(exp.front)) bad.push(`level4 data front ${J(c4.front)} != ${J(exp.front)}`);
  if (J(c4.side) !== J(exp.side)) bad.push(`level4 data side ${J(c4.side)} != ${J(exp.side)}`);
  // 2) clueCard 가 실제로 그리는 칸 순서 = 화면 격자
  const r2 = renderedClue(p.target, 2);
  if (J(r2.counts) !== J(exp.counts)) bad.push(`level2 drawn ${J(r2.counts)} != ${J(exp.counts)}`);
  const r3 = renderedClue(p.target, 3);
  if (J(r3.layers) !== J(exp.layers)) bad.push('level3 drawn layers differ');
  if (J(r3.caps) !== J(exp.layers.map((_, i) => `${i + 1}층`))) bad.push(`level3 captions ${J(r3.caps)}`);
  const r4 = renderedClue(p.target, 4);
  for (const v of ['top', 'front', 'side']) if (J(r4[v]) !== J(exp[v])) bad.push(`level4 drawn ${v} ${J(r4[v])} != ${J(exp[v])}`);
  if (r4.topCap !== '위' || r4.frontCap !== '앞' || r4.sideCap !== '옆') bad.push('level4 captions');
  // 3) 판 칸(바닥) = 위에서 본 모양
  const fp = footprint(p.target);
  const fromTop = new Set();
  c4.top.forEach((row, z) => row.forEach((v, x) => { if (v) fromTop.add(`${x},${z}`); }));
  if (J([...fromTop].sort()) !== J([...fp.cells].sort())) bad.push('board cells != top view');
  return bad;
}

// ---------- E. 4단계 다른 정답 ----------
// 판 칸마다 높이 1..H(아래가 빈 칸 없음), 칸 수 합 = 목표 칸 수, 위·앞·옆이 목표와 같은 모양을 모두 센다.
// 그중 주어진 조각으로 (낙하 순서까지) 쌓을 수 있는 모양을 따로 세고, judge(4)가 받는지 본다.
export function level4Alternatives(p) {
  const fp = footprint(p.target);
  const Ht = height(p.target);
  const N = p.target.length;
  const cols = [...fp.cells].map((k) => k.split(',').map(Number));
  const want = expectedScreenClues(p.target);
  const shapes = [];
  const hs = new Array(cols.length).fill(1);
  const rec = (i, left) => {
    if (i === cols.length) {
      if (left !== 0) return;
      const cells = [];
      cols.forEach(([x, z], k) => { for (let y = 0; y < hs[k]; y++) cells.push([x, y, z]); });
      const e = expectedScreenClues(cells.concat([]));
      // 목표와 같은 판(같은 w·d)이므로 격자 크기가 같다
      if (J(e.top) === J(want.top) && J(e.front) === J(want.front) && J(e.side) === J(want.side)) shapes.push(cells);
      return;
    }
    const rest = cols.length - i - 1;
    for (let h = 1; h <= Ht; h++) {
      const l = left - h;
      if (l < rest || l > rest * Ht) continue;
      hs[i] = h;
      rec(i + 1, l);
    }
  };
  rec(0, N);
  const tkey = new Set(p.target.map(key));
  const out = { id: p.id, viewShapes: shapes.length, buildable: 0, alternatives: 0, rejected: [] };
  for (const s of shapes) {
    const sol = solve(s, p.pieces, { limit: 1 }).solutions[0];
    if (!sol) continue;
    out.buildable++;
    const isTarget = s.length === tkey.size && s.every((c) => tkey.has(key(c)));
    if (!isTarget) out.alternatives++;
    const v = judge(sol, p.target, 4);
    if (v !== 'solved') out.rejected.push({ shape: s, verdict: v });
  }
  return out;
}

// ---------- 전체 ----------
export function auditAll({ full = true, seeds = SEEDS } = {}) {
  const bank = loadBanks();
  const ids = new Set();
  const res = { A: [], B: [], D: [], E: [], conventions: staticConventions(), count: bank.length, bank: new Map(bank.map((p) => [p.id, p])) };
  for (const p of bank) {
    const a = checkData(p, ids);
    if (a.length) res.A.push({ id: p.id, issues: a });
    const r = checkReach(p, { seeds, full });
    res.B.push(r);
    const d = checkClues(p);
    if (d.length) res.D.push({ id: p.id, issues: d });
    if (p.stage === 4) res.E.push(level4Alternatives(p));
  }
  return res;
}

function main() {
  const t0 = Date.now();
  const res = auditAll();
  if (process.argv.includes('--json')) { console.log(J(res, null, 1)); return; }
  const B = res.B;
  const bFail = B.filter((r) => r.fails.length);
  const startBad = B.filter((r) => r.startBad.length);
  const model = B.filter((r) => r.modelMismatch.length);
  const single = B.filter((r) => r.maxOrders === 1);
  const few = B.filter((r) => r.maxOrders > 1 && r.maxOrders / r.totalOrders <= 0.1);
  const eAlt = res.E.filter((e) => e.alternatives > 0);
  const eRej = res.E.filter((e) => e.rejected.length);
  const hist = (xs) => xs.reduce((m, x) => { m[x] = (m[x] ?? 0) + 1; return m; }, {});
  const rows = [
    ['A 데이터', res.count, res.A.length, res.A.map((x) => x.id).join(' ')],
    ['B 시작 배치', res.count, startBad.length, startBad.map((x) => x.id).join(' ')],
    ['B 조작으로 도달', res.count, bFail.length, bFail.map((x) => x.id).join(' ')],
    ['B solver/게임 일치', res.count, model.length, model.map((x) => x.id).join(' ')],
    ['C 가능한 순서 1개뿐', res.count, single.length, single.map((x) => x.id).join(' ')],
    ['D 단서', res.count, res.D.length, res.D.map((x) => x.id).join(' ')],
    ['E 4단계 judge 거부', res.E.length, eRej.length, eRej.map((x) => x.id).join(' ')],
  ];
  console.log('검사                 | 문제 | 실패 | 문제 번호');
  for (const [n, c, f, l] of rows) console.log(`${n.padEnd(18)} | ${String(c).padStart(4)} | ${String(f).padStart(4)} | ${l}`);
  console.log(`\nB: 실제 조작 흉내 ${B.reduce((s, r) => s + r.played, 0)}회(실패 ${B.reduce((s, r) => s + r.fails.length, 0)}회), 시드 ${SEEDS.join(',')}`);
  console.log(`C: 해답 수 분포 ${J(hist(B.map((r) => r.solutions)))}`);
  console.log(`C: 가능한 순서 수(해답 중 최대) 분포 ${J(hist(B.map((r) => r.maxOrders)))}`);
  console.log(`C: 순서 10% 이하(1개 초과) ${few.length}문제: ${few.map((r) => `${r.id}(${r.maxOrders}/${r.totalOrders})`).join(' ')}`);
  console.log(`E: 위·앞·옆 일치 모양 수 분포 ${J(hist(res.E.map((e) => e.viewShapes)))}`);
  console.log(`E: 조각으로 쌓을 수 있는 다른 정답 수 분포 ${J(hist(res.E.map((e) => e.alternatives)))}`);
  console.log(`E: 다른 정답이 있는 문제 ${eAlt.length}개: ${eAlt.map((e) => `${e.id}(${e.alternatives})`).join(' ')}`);
  const sumH = (v) => B.reduce((a, r) => a.map((n, k) => n + r.hops[v][k]), [0, 0, 0, 0, 0, 0, 0]);
  console.log(`B: 링으로 돌린 결과 [돌림, 다른 조각 위로 올라탐, 그중 판 위, 판 밖->판 칸 진입, 제자리에서 옆으로 비킴, 그중 1칸 넘게, 떠 있는 조각] 시작 자리에서 ${J(sumH('rotateFirst'))}, 판 위에서 ${J(sumH('moveFirst'))}`);
  const solField = B.filter((r) => Math.min(r.solutions, SOLUTION_LIMIT) !== Math.min(res.bank.get(r.id).solutions, SOLUTION_LIMIT));
  console.log(`A: solutions 필드와 solver 해답 수(최대 ${SOLUTION_LIMIT}) 다른 문제 ${solField.length}개 ${solField.map((r) => `${r.id}(${res.bank.get(r.id).solutions} vs ${r.solutions})`).join(' ')}`);
  console.log(`단서 카드 배치 ${J(res.conventions)}`);
  for (const x of res.A) console.log(`A ${x.id}: ${x.issues.join('; ')}`);
  for (const x of startBad) console.log(`B-start ${x.id}: ${x.startBad.join('; ')}`);
  for (const x of bFail) console.log(`B ${x.id}: ${x.fails.slice(0, 3).join(' | ')}${x.fails.length > 3 ? ` (+${x.fails.length - 3})` : ''}`);
  for (const x of model) console.log(`B-model ${x.id}: ${x.modelMismatch.join('; ')}`);
  for (const x of res.D) console.log(`D ${x.id}: ${x.issues.join('; ')}`);
  console.log(`\n${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
