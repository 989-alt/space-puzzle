import test from 'node:test';
import assert from 'node:assert/strict';
import {
  footprint,
  hasOverhang,
  topCounts,
  layerGrids,
  frontView,
  sideView,
  clueFor,
} from '../src/core/clues.js';

// 높이 표(행 = z 오름차순 뒤→앞, 열 = x)에서 칸 목록을 만든다.
function cellsFromHeights(rows) {
  const cells = [];
  rows.forEach((row, z) => row.forEach((h, x) => { for (let y = 0; y < h; y++) cells.push([x, y, z]); }));
  return cells;
}

const T = cellsFromHeights([[2, 2, 2, 1], [2, 1, 1, 1]]);

test('footprint of prototype', () => {
  const fp = footprint(T);
  assert.equal(fp.w, 4);
  assert.equal(fp.d, 2);
  assert.deepEqual([...fp.cells].sort(), ['0,0', '0,1', '1,0', '1,1', '2,0', '2,1', '3,0', '3,1']);
});

test('footprint uses only y=0 cells', () => {
  const fp = footprint([[0, 0, 0], [1, 0, 0], [0, 1, 0]]);
  assert.deepEqual({ w: fp.w, d: fp.d, cells: [...fp.cells].sort() }, { w: 2, d: 1, cells: ['0,0', '1,0'] });
});

test('topCounts of prototype', () => assert.deepEqual(topCounts(T, footprint(T)), [[2, 2, 2, 1], [2, 1, 1, 1]]));

test('frontView rows top-first', () =>
  assert.deepEqual(frontView(T, footprint(T)), [[true, true, true, false], [true, true, true, true]]));

test('sideView columns front-to-back', () => assert.deepEqual(sideView(T, footprint(T)), [[true, true], [true, true]]));

test('sideView puts front (z=d-1) in column 0', () => {
  // 앞줄(z=1)만 2층: 오른쪽에서 보면 앞이 왼쪽(열 0)
  const S = cellsFromHeights([[1, 1], [2, 1]]);
  assert.deepEqual(sideView(S, footprint(S)), [[true, false], [true, true]]);
});

test('frontView and sideView accept an explicit height H', () => {
  const fp = footprint(T);
  assert.deepEqual(frontView(T, fp, 3), [[false, false, false, false], [true, true, true, false], [true, true, true, true]]);
  assert.deepEqual(sideView(T, fp, 3), [[false, false], [true, true], [true, true]]);
});

test('layer 2 grid', () =>
  assert.deepEqual(layerGrids(T, footprint(T))[1], [[true, true, true, false], [true, false, false, false]]));

test('layerGrids has one grid per layer', () => {
  const g = layerGrids(T, footprint(T));
  assert.equal(g.length, 2);
  assert.deepEqual(g[0], [[true, true, true, true], [true, true, true, true]]);
});

test('overhang detected', () => assert.equal(hasOverhang([[0, 0, 0], [1, 1, 0]]), true));

test('no overhang on supported stack', () => assert.equal(hasOverhang(T), false));

test('clueFor level 1 carries only footprint', () => {
  const c = clueFor(T, 1);
  assert.equal(c.level, 1);
  assert.equal(c.fp.w, 4);
  assert.equal(c.counts, undefined);
  assert.equal(c.layers, undefined);
  assert.equal(c.front, undefined);
});

test('clueFor level 2 gives counts', () => assert.deepEqual(clueFor(T, 2).counts, [[2, 2, 2, 1], [2, 1, 1, 1]]));

test('clueFor level 3 gives layers', () => assert.deepEqual(clueFor(T, 3).layers, layerGrids(T, footprint(T))));

test('clueFor level 4 gives top, front, side', () => {
  const c = clueFor(T, 4);
  assert.deepEqual(c.top, [[true, true, true, true], [true, true, true, true]]);
  assert.deepEqual(c.front, [[true, true, true, false], [true, true, true, true]]);
  assert.deepEqual(c.side, [[true, true], [true, true]]);
});
