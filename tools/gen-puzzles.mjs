// 단계별 문제 은행 생성기. node tools/gen-puzzles.mjs → data/puzzles-s1..4.json
// 스펙 4.2 "거꾸로 만들기": 목표 모양을 먼저 만들고 조각으로 쪼갠 뒤, 해답 탐색기로 풀림·해답 수를 센다.
// 시드 고정이라 같은 코드면 같은 결과가 나온다.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { key, normalize, orientations } from '../src/core/pieces.js';
import { footprint, hasOverhang } from '../src/core/clues.js';
import { solve } from '../src/core/solver.js';
import { validOrders, level4Alternatives } from './audit-puzzles.mjs';

const SEED = 20261021;
const PER_STAGE = 40; // 은행 크기(30 이상)
const SOLUTION_LIMIT = 100; // 해답 수는 여기서 멈춰 센다

// 단계별 생성 규칙. sizes: 조각 칸 수 후보와 가중치(대부분 4칸).
const STAGES = {
  1: { pieces: [3], cells: [10, 12], W: 4, D: 3 },
  2: { pieces: [3], cells: [11, 12], W: 4, D: 3 },
  3: { pieces: [4], cells: [13, 16], W: 5, D: 3 },
  4: { pieces: [4, 5], cells: [15, 19], W: 5, D: 4 },
};
const SIZE_WEIGHTS = [[4, 0.7], [3, 0.15], [5, 0.15]];
const MAX_DIAG = 6.4; // 판 경계 상자 대각선(작업대 R=6 안에 판 + 둘레 1칸 + 조각 자리)
const MAX_SAME_SHAPE = 2;
const MIN_FILL = 0.6; // 바닥 칸 수 / 바닥 경계 상자 넓이

// ---- 시드 난수 ----
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rand = mulberry32(SEED);
const randInt = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1)); // 양 끝 포함
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function weighted(pairs) {
  let r = rand() * pairs.reduce((s, p) => s + p[1], 0);
  for (const [v, w] of pairs) if ((r -= w) < 0) return v;
  return pairs[pairs.length - 1][0];
}

const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const byYZX = (a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0];

// 회전으로 겹치는 모양끼리 같은 대표 방향(정규화됨). 은행에는 이 방향만 담아 해답 방향이 새지 않게 한다.
function canonical(cells) {
  let best = null, bestSig = null;
  for (const o of orientations(cells)) {
    const sig = o.map(key).join(';');
    if (bestSig === null || sig < bestSig) { best = o; bestSig = sig; }
  }
  return { cells: best, id: bestSig };
}

// ---- 조각 크기 ----
function pickSizes(rule) {
  for (let t = 0; t < 1000; t++) {
    const n = pick(rule.pieces);
    const sizes = Array.from({ length: n }, () => weighted(SIZE_WEIGHTS));
    const sum = sizes.reduce((a, b) => a + b, 0);
    if (sum >= rule.cells[0] && sum <= rule.cells[1]) return sizes;
  }
  throw new Error('no size combination');
}

// ---- 목표 모양: 바닥(4-연결) + 2층 칸(돌출 없음) ----
// 바닥 칸 F개를 W×D 상자 안에서 무작위로 키운다.
function growFloor(F, W, D) {
  const start = [randInt(0, W - 1), randInt(0, D - 1)];
  const set = new Map([[`${start[0]},${start[1]}`, start]]);
  while (set.size < F) {
    const front = [];
    for (const [x, z] of set.values())
      for (const [dx, dz] of N4) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= W || nz >= D || set.has(`${nx},${nz}`)) continue;
        front.push([nx, nz]);
      }
    if (!front.length) return null;
    const c = pick(front);
    set.set(`${c[0]},${c[1]}`, c);
  }
  return [...set.values()];
}

// 2층 칸 U개: 대체로 붙어 있는 덩어리(건물처럼), 가끔 흩어진 칸.
function pickUpper(floor, U) {
  if (rand() < 0.3) return shuffle([...floor]).slice(0, U);
  const inFloor = new Map(floor.map((c) => [`${c[0]},${c[1]}`, c]));
  const start = pick(floor);
  const set = new Map([[`${start[0]},${start[1]}`, start]]);
  while (set.size < U) {
    const front = [];
    for (const [x, z] of set.values())
      for (const [dx, dz] of N4) {
        const k = `${x + dx},${z + dz}`;
        if (inFloor.has(k) && !set.has(k)) front.push(inFloor.get(k));
      }
    if (!front.length) return null;
    const c = pick(front);
    set.set(`${c[0]},${c[1]}`, c);
  }
  return [...set.values()];
}

function makeTarget(N, rule) {
  // 2층 칸 수 U = N − F: 2층이 2칸 이상이고 바닥 전체를 덮지는 않게(높이가 섞이게).
  const fMin = Math.ceil((N + 1) / 2);
  const fMax = Math.min(N - 2, rule.W * rule.D);
  if (fMin > fMax) return null;
  const F = randInt(fMin, fMax);
  const floor = growFloor(F, rule.W, rule.D);
  if (!floor) return null;
  const upper = pickUpper(floor, N - F);
  if (!upper) return null;
  const mx = Math.min(...floor.map((c) => c[0]));
  const mz = Math.min(...floor.map((c) => c[1]));
  const cells = [
    ...floor.map(([x, z]) => [x - mx, 0, z - mz]),
    ...upper.map(([x, z]) => [x - mx, 1, z - mz]),
  ];
  return cells.sort(byYZX);
}

// ---- 쪼개기: 목표 칸을 정해진 크기의 연결 조각으로 ----
function partition(target, sizes) {
  const all = new Map(target.map((c) => [key(c), c]));
  const nbrs = (c, free) =>
    N6.map((d) => key([c[0] + d[0], c[1] + d[1], c[2] + d[2]])).filter((k) => free.has(k));
  for (let attempt = 0; attempt < 60; attempt++) {
    const free = new Set(all.keys());
    const pieces = [];
    let ok = true;
    for (const size of shuffle([...sizes])) {
      // 남은 이웃이 가장 적은 칸에서 시작해 외톨이 칸이 덜 생기게 한다.
      let minDeg = Infinity, seeds = [];
      for (const k of free) {
        const deg = nbrs(all.get(k), free).length;
        if (deg < minDeg) { minDeg = deg; seeds = [k]; } else if (deg === minDeg) seeds.push(k);
      }
      const piece = new Set([pick(seeds)]);
      free.delete([...piece][0]);
      while (piece.size < size) {
        const front = new Set();
        for (const k of piece) for (const nk of nbrs(all.get(k), free)) front.add(nk);
        if (!front.size) { ok = false; break; }
        const k = pick([...front]);
        piece.add(k);
        free.delete(k);
      }
      if (!ok) break;
      pieces.push([...piece].map((k) => all.get(k)));
    }
    if (ok && free.size === 0) return pieces;
  }
  return null;
}

// ---- 필터 ----
function footprintOk(target, rule) {
  const fp = footprint(target);
  // 대각선은 소수 첫째 자리로 반올림해 비교한다: 표의 최대 바닥 5×4(√41 = 6.403)가 6.4 안에 들게.
  // 미리보기 검수 결과: 바닥이 경계 상자를 너무 성기게 채우면 한 칸 폭 팔이 뻗은 뱀 모양이 되어
  // 3D로 읽기 어렵다. 경계 상자의 60% 이상을 채운 바닥만 쓴다.
  const fill = fp.cells.size / (fp.w * fp.d);
  return fp.w <= rule.W && fp.d <= rule.D && fill >= MIN_FILL &&
    Math.round(Math.hypot(fp.w, fp.d) * 10) / 10 <= MAX_DIAG;
}

// 단계 4(위·앞·옆 단서)에서 세 모습이 모양을 뻔히 다 드러내지 않게:
// 바닥이 꽉 찬 직사각형이 아니거나 높이가 섞여 있어야 한다(꽉 찬 상자 금지).
function stage4Meaningful(target) {
  const fp = footprint(target);
  const fullRect = fp.cells.size === fp.w * fp.d;
  const heights = new Set();
  for (const k of fp.cells) {
    const [x, z] = k.split(',').map(Number);
    heights.add(target.filter((c) => c[0] === x && c[2] === z).length);
  }
  return !fullRect || heights.size > 1;
}

// 회전(y축 4방향)해도 같은 목표 + 같은 조각 모음이면 같은 문제로 본다.
function puzzleKey(target, pieceIds) {
  let t = target, best = null;
  for (let r = 0; r < 4; r++) {
    const sig = normalize(t).map(key).join(';');
    if (best === null || sig < best) best = sig;
    t = t.map(([x, y, z]) => [z, y, -x]);
  }
  return `${best}|${[...pieceIds].sort().join('|')}`;
}

// 품질 조건(2026-10-22 감사 2차):
//  - 낙하 순서: 해답(최대 ORDER_SOLUTION_LIMIT개) 중 하나라도 가능한 놓는 순서가 MIN_ORDERS개 이상(순서 하나만 허용하면 학생이 막힘)
//  - 4단계: 위·앞·옆이 같고 조각으로 쌓을 수 있는 다른 정답이 MAX_ALTERNATIVES개 이하(단서가 모양을 충분히 정함)
// 감사 도구(tools/audit-puzzles.mjs)와 같은 함수로 센다.
export const MIN_ORDERS = 2;
export const MAX_ALTERNATIVES = 8;
const ORDER_SOLUTION_LIMIT = 50; // 감사 도구 SOLUTION_LIMIT 과 같게

export function maxDropOrders(target, pieces) {
  const sols = solve(target, pieces, { limit: ORDER_SOLUTION_LIMIT }).solutions;
  return Math.max(0, ...sols.map((s) => validOrders(s).length));
}

function qualityOk(p) {
  if (maxDropOrders(p.target, p.pieces) < MIN_ORDERS) return 'orders';
  if (p.stage === 4 && level4Alternatives(p).alternatives > MAX_ALTERNATIVES) return 'alternatives';
  return null;
}

function generateStage(stage) {
  const rule = STAGES[stage];
  const out = [];
  const seen = new Set();
  const stats = { tries: 0, noTarget: 0, footprint: 0, noSplit: 0, sameShape: 0, dup: 0, stage4: 0, unsolvable: 0 };
  // 후보 하나를 만들어 기본 필터를 통과하면 돌려준다(난수 사용 순서는 2026-10-21 판과 같다).
  const candidate = () => {
    stats.tries++;
    const sizes = pickSizes(rule);
    const N = sizes.reduce((a, b) => a + b, 0);
    const target = makeTarget(N, rule);
    if (!target || hasOverhang(target)) { stats.noTarget++; return null; }
    if (!footprintOk(target, rule)) { stats.footprint++; return null; }
    if (stage === 4 && !stage4Meaningful(target)) { stats.stage4++; return null; }
    const split = partition(target, sizes);
    if (!split) { stats.noSplit++; return null; }
    const pieces = split.map(canonical);
    const counts = new Map();
    for (const p of pieces) counts.set(p.id, (counts.get(p.id) ?? 0) + 1);
    if (Math.max(...counts.values()) > MAX_SAME_SHAPE) { stats.sameShape++; return null; }
    const pk = puzzleKey(target, pieces.map((p) => p.id));
    if (seen.has(pk)) { stats.dup++; return null; }
    const { count } = solve(target, pieces.map((p) => p.cells), { limit: SOLUTION_LIMIT });
    if (count < 1) { stats.unsolvable++; return null; }
    seen.add(pk);
    return { stage, target, pieces: pieces.map((p) => p.cells), solutions: count };
  };
  while (out.length < PER_STAGE && stats.tries < 200000) {
    const c = candidate();
    if (c) out.push(c);
  }
  if (out.length < PER_STAGE) throw new Error(`stage ${stage}: only ${out.length} puzzles`);
  // 해답 수 순서가 아니라 단계 안에서 고르게 섞어 저장한다.
  shuffle(out);
  // 품질 조건에 걸린 문제만 그 자리(같은 번호)에서 조각 수가 같은 새 후보로 바꾼다. 나머지 번호의 문제는 그대로다.
  const replaced = [];
  for (let i = 0; i < out.length; i++) {
    const why = qualityOk(out[i]);
    if (!why) continue;
    let c = null;
    while (!c && stats.tries < 400000) {
      c = candidate();
      // 단계 난이도가 그대로이게 조각 수가 같은 후보만 쓴다
      if (c && (c.pieces.length !== out[i].pieces.length || qualityOk(c))) c = null;
    }
    if (!c) throw new Error(`stage ${stage}: no replacement for #${i + 1}`);
    replaced.push(`#${i + 1}(${why})`);
    out[i] = c;
  }
  stats.replaced = replaced.join(' ');
  return {
    puzzles: out.map((p, i) => ({ id: `s${stage}-${String(i + 1).padStart(3, '0')}`, ...p })),
    stats,
  };
}

function toJson(puzzles) {
  return `[\n${puzzles.map((p) => JSON.stringify(p)).join(',\n')}\n]\n`;
}

function main() {
  const dataDir = new URL('../data/', import.meta.url);
  mkdirSync(dataDir, { recursive: true });
  const t0 = performance.now();
  for (const stage of [1, 2, 3, 4]) {
    rand = mulberry32(SEED + stage); // 단계마다 독립 시드라 한 단계 규칙을 바꿔도 다른 단계는 그대로다
    const t = performance.now();
    const { puzzles, stats } = generateStage(stage);
    writeFileSync(new URL(`puzzles-s${stage}.json`, dataDir), toJson(puzzles));
    const sol = puzzles.map((p) => p.solutions);
    const hist = {};
    for (const s of sol) {
      const b = s === 1 ? '1' : s <= 3 ? '2-3' : s <= 10 ? '4-10' : s < SOLUTION_LIMIT ? '11-99' : `${SOLUTION_LIMIT}+`;
      hist[b] = (hist[b] ?? 0) + 1;
    }
    const sizeHist = {};
    for (const p of puzzles) for (const pc of p.pieces) sizeHist[pc.length] = (sizeHist[pc.length] ?? 0) + 1;
    console.log(
      `s${stage}: ${puzzles.length} puzzles in ${((performance.now() - t) / 1000).toFixed(2)}s`,
      `solutions ${JSON.stringify(hist)} pieceSizes ${JSON.stringify(sizeHist)}`,
      `rejects ${JSON.stringify(stats)}`,
    );
  }
  console.log(`total ${((performance.now() - t0) / 1000).toFixed(2)}s`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
