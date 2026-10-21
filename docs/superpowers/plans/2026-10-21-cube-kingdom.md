# 큐브 왕국 건축가 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 6학년 「공간과 입체」 3D 블록 쌓기 퍼즐 정적 웹앱(1~4단계 단서, 점수·연속, 섬 성장, 조작 안내, 정답 연출)을 한 번에 완성한다.

**Architecture:** 빌드 도구 없는 ES 모듈 정적 사이트다. `src/core/`는 three.js와 무관한 순수 로직이며 Node 내장 테스트(`node --test`)로 검증한다. `src/scene/`은 three.js r160(저장소에 내려받아 둠)으로 배경 그림에 맞춘 3D 장면과 입력을 맡는다. `src/ui/`는 DOM 화면을 맡는다. 문제 은행은 `tools/`의 생성기로 미리 만든 JSON이다. 화면 검증은 Playwright + 시스템 Edge 헤드리스로 한다.

**Tech Stack:** HTML/CSS/ES modules, three.js 0.160.0 (vendored), Node 24 `node --test`, Python Playwright (`channel="msedge"`), Pillow

**Spec:** `docs/superpowers/specs/2026-10-21-cube-kingdom-design.md` (시안: `design/prototype/design-v2.html`, `design/prototype/design-v4-game.html`)

## Global Constraints

- 백엔드·외부 API·계정·이름 입력 없음. 저장은 `localStorage`만, 모든 접근은 try/catch.
- 빌드 도구(vite 등) 금지. 한글 경로(`C:\Users\4F 전담실`)에서 깨진다. 브라우저가 바로 읽는 ES 모듈만 쓴다.
- three.js `0.160.0`을 `vendor/three/`에 넣는다. CDN 런타임 의존 금지(학교망 차단 대비). import map: `"three": "./vendor/three/three.module.js"`, `"three/addons/": "./vendor/three/addons/"`.
- 좌표: 칸 `[x, y, z]`, y가 위, +z가 "앞"(카메라 쪽). 판 칸은 목표 바닥(y=0) 칸과 같고, 최소 x·z가 0이다.
- 3D 고정값: 작업대 반지름 `R = 6`, 화각 `FOV = 22`, 배경 `game-bg-v4.png` 1344×768에서 작업대 타원 `{cx:672, cy:418, a:440, b:250}`, 쌓기나무 `RoundedBoxGeometry(.995,.995,.995,2,.05)`, 경계 여유 `0.15`, 시작 반지름 `START_R = 3.9`. 확대·축소 없음.
- 입력 고정값: 끌기 문턱 8px, 길게 누르기 450ms, 회전판 감도 0.008 rad/px.
- 점수: `(100 + max(0, 60 − 경과초(내림))) × 배율 × (쉬운 단서면 0.5)`, 반올림. 배율: 연속 1~2 ×1, 3 ×1.5, 4~5 ×2, 6+ ×3.
- 단계: 1~4. 쉬운 단서 없이 2연속 정답이면 승급. 쉬운 단서 버튼은 2단계 이상에서 60초 뒤.
- 섬 단계: `min(3, floor(누적정답/5))` → `island-1..4.png`.
- UI 문구는 한국어. 아이콘은 SVG(Lucide 계열)만, 이모지 금지. 터치 영역 48px 이상. `prefers-reduced-motion`이면 빛줄기 회전·색종이 끔.
- 색 토큰: ink `#2A1A5E`, purple `#4B2A9A`/`#6A44C9`, gold `#FFF1A6`→`#FFC529`→`#F29B00`(edge `#B4690A`), cream `#FFF8E8`, chip `rgba(36,22,74,.72)`, ghost `#8FEFFF`(emissive `#2FC8F0`). 조각 색 순서: `#3B9BFF`, `#3DD47A`, `#FF8A2B`, `#A86BFF`, `#FFD23F`.
- 글꼴: 제목 Jua, 본문 Pretendard(웹폰트, 실패 시 시스템 글꼴).
- 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **경계에서 조각을 돌리면** 작업대 밖이나 다른 조각 속으로 들어가면 안 되고, 안쪽으로 밀려 위에 떨어져야 한다. → Task 5 `rotateNearEdgeStaysInside` 테스트
2. **끌던 중 두 번째 손가락·포인터 취소**가 오면, 조각이 공중(+0.35)에 떠 있으면 안 되고 마지막 칸에 내려앉아야 한다. → Task 7 `cancelMidDragLands` e2e
3. **창 크기·방향이 바뀌면** 카메라가 다시 맞춰져 작업대 타원 오차가 2% 이내여야 하고, 세로 화면이면 회전 안내가 떠야 한다. → Task 6 `calibrationAcrossAspects` 테스트, Task 8 `portraitWarning` e2e
4. **localStorage가 막힌 환경**(접근 시 예외)에서도 게임 시작·점수·진행이 동작해야 한다. → Task 4 `storageThrowingStillWorks` 테스트
5. **정답 직후 같은 문제가 두 번 판정**(마지막 끌기와 회전 버튼이 겹침 등)되어도 점수·연속·섬은 한 번만 오른다. → Task 4 `recordSolveIdempotent` 테스트

---

## File Structure

```
index.html                 화면 뼈대 + import map
styles/base.css            토큰·글꼴·공통(칩, 금색 버튼, 입체 로고, 카드)
styles/screens.css         시작·안내·게임·정답 화면 배치
src/core/pieces.js         칸 회전·정규화·크기·방향 목록·눕히기
src/core/board.js          낙하 높이, 점유 집합, 월드 칸
src/core/clues.js          단서 1~4 데이터, 돌출 검사, 단서 일치 판정
src/core/judge.js          solved / mismatch / incomplete 판정
src/core/solver.js         정확 덮기 해답 탐색 + 낙하 순서 가능 검사
src/core/progress.js       점수·연속·단계·승급·건너뛰기·섬 단계
src/core/storage.js        안전한 localStorage
src/core/layout.js         작업대 안 판정, 끌어 넣기, 시작 배치
src/scene/calibrate.js     배경 타원에 카메라 맞추기
src/scene/world.js         빛·그림자 바닥·회전판·판·목표 모양·조각 메시
src/scene/input.js         끌기·탭·길게 누르기·회전판·링 버튼
src/scene/perf.js          WebGL 생성 실패 처리, 저사양 자동 전환
src/ui/screens.js          화면 전환(시작·안내·게임·정답), 세로 안내
src/ui/hud.js              단계·연속·점수·섬 배지·도구·말풍선
src/ui/clueCard.js         단서 카드 렌더링
src/main.js                게임 흐름 연결, ?e2e 테스트 훅
data/puzzles-s1.json … data/puzzles-s4.json   문제 은행
assets/img/*.png           그림 자산
tools/gen-puzzles.mjs      문제 은행 생성기
tools/preview-sheet.py     문제 미리보기 한 장 그림
tests/*.test.mjs           node --test
tests/e2e/*.py             Playwright(Edge) 화면·조작 검사
```

---

### Task 1: 프로젝트 뼈대 + 칸 회전·낙하 코어

**Files:**
- Create: `package.json`(scripts만, 의존성 없음), `vendor/three/three.module.js`, `vendor/three/addons/geometries/RoundedBoxGeometry.js`, `src/core/pieces.js`, `src/core/board.js`
- Test: `tests/pieces.test.mjs`, `tests/board.test.mjs`

**Interfaces:**
- Produces:
  - `pieces.js`: `key(c:number[3]) -> string`, `normalize(cells) -> cells`(최소 0으로 이동, 정렬 고정), `rotate(cells, axis:'x'|'y'|'z') -> cells`(y: `[x,y,z]→[z,y,-x]`, x: `→[x,-z,y]`, z: `→[-y,x,z]` 뒤 normalize), `dims(cells) -> [w,h,d]`, `orientations(cells) -> cells[]`(중복 없는 최대 24개), `lieFlat(cells, longAxis:'x'|'z') -> cells`(높이 h가 최소인 방향 중 긴 변이 longAxis 쪽)
  - `board.js`: `worldCells(piece:{cells,pos:[x,y,z]}) -> cells`, `occupiedSet(pieces, exceptIndex) -> Set<string>`, `dropY(cells, x, z, occupied:Set) -> number`(겹치지 않는 가장 낮은 y ≥ 0)

- [ ] **Step 1:** `package.json`에 `"type":"module"`, `"scripts":{"test":"node --test tests/"}`를 둔다. three 0.160.0 두 파일을 `https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js`와 `.../examples/jsm/geometries/RoundedBoxGeometry.js`에서 받는다. RoundedBoxGeometry의 `from 'three'`는 import map으로 풀리므로 그대로 둔다. 단, Node 테스트에서 쓰려면 `tests/` 쪽은 `vendor/three/three.module.js`를 직접 import한다.
- [ ] **Step 2: 실패하는 테스트 작성**

```js
// tests/pieces.test.mjs
test('rotate y four times returns original', () => { let c=[[0,0,0],[1,0,0],[1,1,0]]; for(let i=0;i<4;i++) c=rotate(c,'y'); assert.deepEqual(normalize(c), normalize([[0,0,0],[1,0,0],[1,1,0]])); });
test('I-tetracube has 3 orientations', () => assert.equal(orientations([[0,0,0],[1,0,0],[2,0,0],[3,0,0]]).length, 3));
test('L-tricube corner has 12 orientations', () => assert.equal(orientations([[0,0,0],[1,0,0],[0,1,0]]).length, 12));
test('lieFlat makes I-bar height 1 and long along x', () => assert.deepEqual(dims(lieFlat([[0,0,0],[0,1,0],[0,2,0],[0,3,0]],'x')), [4,1,1]));
test('lieFlat long along z', () => assert.deepEqual(dims(lieFlat([[0,0,0],[1,0,0],[2,0,0]],'z')), [1,1,3]));
// tests/board.test.mjs
test('dropY on empty floor is 0', () => assert.equal(dropY([[0,0,0]],0,0,new Set()),0));
test('dropY lands on top of occupied column', () => assert.equal(dropY([[0,0,0]],2,1,new Set(['2,0,1','2,1,1'])),2));
test('dropY of overhang piece rests on highest support', () => assert.equal(dropY([[0,0,0],[1,0,0],[1,1,0]],0,0,new Set(['1,0,0'])),1));
```

- [ ] **Step 3:** `npm test` → FAIL(모듈 없음)
- [ ] **Step 4:** `pieces.js`, `board.js` 구현
- [ ] **Step 5:** `npm test` → PASS
- [ ] **Step 6:** 커밋 `feat: scaffold, vendored three r160, piece rotation and drop core`

---

### Task 2: 단서와 정답 판정

**Files:**
- Create: `src/core/clues.js`, `src/core/judge.js`
- Test: `tests/clues.test.mjs`, `tests/judge.test.mjs`

**Interfaces:**
- Consumes: Task 1 `key`, `normalize`, `worldCells`
- Produces:
  - `footprint(target) -> {w, d, cells:Set<'x,z'>}`(y=0 칸)
  - `hasOverhang(cells) -> boolean`(어떤 칸 아래 y−1이 비고 y>0이면 true)
  - `topCounts(cells, fp) -> number[d][w]`(행=z 오름차순 뒤→앞, 열=x)
  - `layerGrids(cells, fp) -> boolean[h][d][w]`(h = 최대 높이)
  - `frontView(cells, fp) -> boolean[H][w]`(앞(+z)에서 봄, 행 0=맨 위층, 열=x 왼→오)
  - `sideView(cells, fp) -> boolean[H][d]`(오른쪽 옆(+x)에서 봄, 행 0=맨 위층, 열=z 내림차순 앞→뒤. 오른쪽에서 볼 때 앞이 왼쪽)
  - `clueFor(target, level:1|2|3|4) -> {level, fp, counts?, layers?, top?, front?, side?}`(level 1은 ghost용 target만, H는 target 최대 높이로 고정)
  - `matchesClue(cells, target, level) -> boolean`: level 1·2·3은 칸 집합 동일 && !hasOverhang. level 4는 !hasOverhang && 모든 칸이 fp 위 && top·front·side가 target과 같음.
  - `judge(pieces, target, level) -> 'solved'|'mismatch'|'incomplete'`: 어떤 조각이든 fp 밖 칸이 있으면 `incomplete`, 모두 fp 위면 matchesClue로 `solved`/`mismatch`.

- [ ] **Step 1: 실패하는 테스트 작성** (target = 시안 문제: 높이 `[[2,2,2,1],[2,1,1,1]]`, z행)

```js
const T = cellsFromHeights([[2,2,2,1],[2,1,1,1]]); // 테스트 내부 도우미
test('topCounts of prototype', () => assert.deepEqual(topCounts(T, footprint(T)), [[2,2,2,1],[2,1,1,1]]));
test('frontView rows top-first', () => assert.deepEqual(frontView(T, footprint(T)), [[true,true,true,false],[true,true,true,true]]));
test('sideView columns front-to-back', () => assert.deepEqual(sideView(T, footprint(T)), [[true,true],[true,true]]));
test('layer 2 grid', () => assert.deepEqual(layerGrids(T, footprint(T))[1], [[true,true,true,false],[true,false,false,false]]));
test('overhang detected', () => assert.equal(hasOverhang([[0,0,0],[1,1,0]]), true));
test('level 4 accepts a different shape with same three views', () => {
  const A = cellsFromHeights([[2,1],[1,2]]), B = cellsFromHeights([[1,2],[2,1]]);
  assert.equal(matchesClue(B, A, 4), true); assert.equal(matchesClue(B, A, 3), false); });
test('level 4 rejects overhang even if views match', () => { /* T의 (0,1,0)을 (1,1,1)로 옮긴 돌출 모양 → false */ });
test('judge incomplete when a piece is off the board', () => assert.equal(judge([{cells:[[0,0,0]],pos:[9,0,9]}], T, 1), 'incomplete'));
test('judge mismatch when all on board but wrong', () => { /* 모든 칸 fp 위, 모양 다름 → 'mismatch' */ });
test('judge solved for exact target', () => { /* 조각 3개 = 시안 분할(Task 3 DEFS와 같음) → 'solved' */ });
```

- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** 구현
- [ ] **Step 4:** `npm test` → PASS
- [ ] **Step 5:** 커밋 `feat: clue representations and clue-based judging`

---

### Task 3: 해답 탐색기 + 문제 은행 생성

**Files:**
- Create: `src/core/solver.js`, `tools/gen-puzzles.mjs`, `tools/preview-sheet.py`, `data/puzzles-s1.json`…`data/puzzles-s4.json`
- Test: `tests/solver.test.mjs`, `tests/bank.test.mjs`

**Interfaces:**
- Consumes: Task 1 `orientations`, `normalize`, `dropY`, Task 2 `footprint`, `hasOverhang`, `matchesClue`
- Produces:
  - `solve(target, pieceCellsList, {limit=50}) -> {count, solutions: Array<Array<{cells,pos}>>}`: target 칸을 조각 전부로 정확히 덮는 배치. 각 조각은 `orientations` × 평행이동. 낙하 순서가 가능한 해답만 센다.
  - `dropOrderExists(placements) -> boolean`: 남은 조각 중 "지금 점유 상태에서 `dropY`가 자기 y와 같은" 조각을 하나씩 놓아 전부 놓이면 true.
  - 문제 JSON 한 개: `{ "id":"s2-007", "stage":2, "target":[[x,y,z],...], "pieces":[[[x,y,z],...],...], "solutions": n }`. pieces는 정규화된 조각 모양만 담는다(시작 방향은 런타임).
- 생성 규칙(단계별 기본값, 구현자가 조정 가능):

| 단계 | 조각 수 | 목표 칸 수 | 바닥 최대 |
|---|---|---|---|
| 1 | 3 | 10~12 | 4×3 |
| 2 | 3 | 11~12 | 4×3 |
| 3 | 4 | 13~16 | 5×3 |
| 4 | 4~5 | 15~19 | 5×4 |

  - 목표: 높이 1~2, 돌출 없음, 바닥 칸들이 4-연결, 판(바닥 경계 상자)의 대각선 절반 + 판 둘레 1칸 + 조각 배치 공간이 R=6 안에 들어가야 하므로 바닥 경계 상자 대각선 ≤ 6.4
  - 조각: 3~5칸 연결(대부분 4칸), 한 문제 안에 같은 모양 최대 2개
  - 필터: `solutions ≥ 1`, 단계 4는 level 4 단서 기준으로도 판정이 의미 있게(목표 모양의 세 방향 모습과 맞는 모양이 조각으로 만들어질 수 있음)
  - 단계별 30문제 이상, 해답 수 오름차순 대신 단계 안에서 고르게 섞어 저장

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('prototype puzzle is solvable', () => assert.ok(solve(T, DEFS.map(d=>d.cells)).count >= 1));
test('impossible cell count gives 0', () => assert.equal(solve(T, [[[0,0,0]]]).count, 0));
test('drop order rejects slide-under placement', () => { /* 위 칸 조각이 아래 칸 조각보다 먼저일 수밖에 없는 배치 → false */ });
// tests/bank.test.mjs — 문제 은행 전수 검사
for (const s of [1,2,3,4]) test(`bank s${s} all solvable and well-formed`, () => {
  const bank = JSON.parse(readFileSync(`data/puzzles-s${s}.json`)); assert.ok(bank.length >= 30);
  for (const p of bank) { assert.equal(p.pieces.flat().length, p.target.length); assert.equal(hasOverhang(p.target), false); assert.ok(solve(p.target, p.pieces, {limit:1}).count >= 1); } });
```

- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** `solver.js` 구현(백트래킹: 가장 낮은 y·z·x 빈 칸부터 덮기)
- [ ] **Step 4:** `node tools/gen-puzzles.mjs` → `data/puzzles-s1..4.json` 생성. 시드 고정(재현 가능), 실행 시간 출력.
- [ ] **Step 5:** `python tools/preview-sheet.py` → `design/review/puzzles-s{n}.png`(단계별로 목표 모양을 등각 투영한 그림 + 조각 목록). 직접 보고 지나치게 단조롭거나 이상한 문제를 생성 규칙 조정으로 걸러 낸다.
- [ ] **Step 6:** `npm test` → PASS
- [ ] **Step 7:** 커밋 `feat: solver with drop-order check and generated puzzle banks`

---

### Task 4: 점수·연속·단계·저장

**Files:**
- Create: `src/core/progress.js`, `src/core/storage.js`
- Test: `tests/progress.test.mjs`, `tests/storage.test.mjs`

**Interfaces:**
- Produces:
  - `createProgress(saved?) -> state`: `{stage:1, streak:0, promo:0, score:0, solvedTotal:saved?.solvedTotal??0, best:saved?.best??0, lastSolvedId:null}`
  - `multiplier(streak) -> number`(Global Constraints 표)
  - `scoreFor(seconds, streakAfter, usedEasy) -> number`
  - `recordSolve(state, {puzzleId, seconds, usedEasy}) -> {state, gained, promoted, islandUp}`(같은 puzzleId 두 번이면 gained 0, 상태 그대로)
  - `recordSkip(state) -> state`
  - `islandStage(solvedTotal) -> 0..3`, `toNextIsland(solvedTotal) -> number|null`
  - `canUseEasy(stage, elapsedSec) -> boolean`(stage ≥ 2 && elapsed ≥ 60), `easyLevel(stage) -> stage-1`
  - `storage.js`: `load(name, fallback)`, `save(name, value)`. 키 접두사 `ck.`. 이름: `best`, `solvedTotal`, `tutorialSeen`.

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('multiplier table', () => assert.deepEqual([1,2,3,4,5,6,9].map(multiplier), [1,1,1.5,2,2,3,3]));
test('score fast 4th streak', () => assert.equal(scoreFor(26, 4, false), 268));
test('score with easy hint halves', () => assert.equal(scoreFor(70, 1, true), 50));
test('two clean solves promote', () => { let s=createProgress(); s=recordSolve(s,{puzzleId:'a',seconds:10}).state; const r=recordSolve(s,{puzzleId:'b',seconds:10}); assert.equal(r.promoted,true); assert.equal(r.state.stage,2); assert.equal(r.state.promo,0); });
test('easy solve keeps streak but resets promo', () => { /* promo 1 → easy 정답 → streak+1, promo 0 */ });
test('skip lowers streak by one, not below 0, stage unchanged', () => { /* streak 3 → 2; streak 0 → 0 */ });
test('stage caps at 4', () => { /* 4단계에서 2연속 → stage 4 그대로 */ });
test('recordSolveIdempotent', () => { const s=createProgress(); const a=recordSolve(s,{puzzleId:'x',seconds:5}); const b=recordSolve(a.state,{puzzleId:'x',seconds:5}); assert.equal(b.gained,0); assert.deepEqual(b.state,a.state); });
test('island stages every 5 solves', () => assert.deepEqual([0,4,5,14,15,99].map(islandStage), [0,0,1,2,3,3]));
test('storageThrowingStillWorks', () => { globalThis.localStorage={getItem(){throw new Error('x')},setItem(){throw new Error('x')}}; assert.equal(load('best',0),0); assert.doesNotThrow(()=>save('best',5)); });
```

- [ ] **Step 2:** FAIL 확인 → **Step 3:** 구현 → **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat: scoring, streak, stage progression and safe storage`

---

### Task 5: 작업대 배치 규칙

**Files:**
- Create: `src/core/layout.js`
- Test: `tests/layout.test.mjs`

**Interfaces:**
- Consumes: Task 1 `dims`, `lieFlat`, `rotate`, `dropY`, Task 2 `footprint`
- Produces:
  - `ISLAND_R = 6`, `boardCenter(fp) -> {x: fp.w/2, z: fp.d/2}`
  - `fits(cells, x, z, center, r=ISLAND_R) -> boolean`(모든 칸의 네 모서리 거리 ≤ r − 0.15)
  - `clampInside(cells, x, z, center) -> [x, z]`(중심 쪽으로 한 칸씩, 최대 20번)
  - `startAngles(n) -> number[]`: 3 → `[180,90,0]`, 4 → `[180,135,45,0]`, 5 → `[180,135,90,45,0]`(도, 0=+x, 90=+z 앞)
  - `placeStarts(pieceCellsList, fp, rng) -> Array<{cells, x, z}>`: 각 조각을 rng로 한 번 이상 돌린 뒤 `lieFlat`. 앞·뒤 각도(|sin|>0.7)는 긴 변이 x, 옆 각도는 z. 금지 칸 = 판 칸 + 둘레 1칸 + 이미 놓은 조각 칸 + 둘레 1칸. `fits`를 만족하는 정수 위치 중 `center + START_R·(cos,sin) − 크기/2`에 가장 가까운 곳.
  - `movePiece(piece, x, z, pieces, center) -> piece`(clampInside → dropY)
  - `rotatePiece(piece, axis, pieces, center) -> piece`(rotate → clampInside → dropY)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
test('starts never overlap board ring or each other, all fit', () => { for (const p of bankSample(20)) { const st=placeStarts(p.pieces, footprint(p.target), seeded(1)); /* 모든 칸이 판+1칸 밖, 서로 1칸 이상 떨어짐, fits true */ } });
test('clamp pulls far drag back inside', () => { const [x,z]=clampInside([[0,0,0],[1,0,0]], 40, 40, {x:2,z:1}); assert.ok(fits([[0,0,0],[1,0,0]], x, z, {x:2,z:1})); });
test('rotateNearEdgeStaysInside', () => { /* I-bar를 경계에 붙여 놓고 rotatePiece('y') → fits true, 다른 조각과 칸 겹침 없음(dropY로 위에 얹힘 허용) */ });
```

- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat: workspace bounds and tidy start placement`

---

### Task 6: 3D 장면 (보정·회전판·판·조각·저사양)

**Files:**
- Create: `src/scene/calibrate.js`, `src/scene/world.js`, `src/scene/perf.js`, `assets/img/game-bg-v4.png`(← `design/prototype/`)
- Test: `tests/calibrate.test.mjs`, `tests/e2e/scene_shot.py`

**Interfaces:**
- Consumes: Task 2 `footprint`, Task 5 `boardCenter`
- Produces:
  - `calibrate.js`: `BG = {w:1344,h:768,cx:672,cy:418,a:440,b:250}`, `fitCamera(camera, W, H, {R=6, fov=22}) -> {errX, errY, errA, errB}`(px). 시안 `design-v4-game.html`의 `fit()`과 같은 방법: 처음에는 `pitch = asin(b/a)`, `D = R·f/a`. 그 뒤 6회 반복으로 투영한 타원의 좌우·위아래 끝을 그림 값(`background-size: cover; background-position: center`로 환산)에 맞추고, `setViewOffset`으로 위치를 맞춘다.
  - `world.js`: `createWorld(renderer, scene, camera) -> world`
    - `world.setPuzzle(target)`: 판 = 바닥 칸 모양, 보라 틀 + 금테 + 크림 칸, "앞" 표시
    - `world.setPieces(pieces)`: pieces는 `{cells,pos,color}`
    - `world.updatePiece(i, piece, {lift:boolean})`
    - `world.showGhost(bool)`
    - `world.setSpin(rad)` / `world.getSpin()`
    - `world.pickPiece(ndc) -> index|-1`
    - `world.floorPoint(ndc) -> {x,z}|null`(판 좌표)
    - `world.bounce(i)`, `world.shakeBoard()`, `world.frame(dt)`
    - 빛: Hemisphere(`0xFFF4E0`,`0xC9A57A`,1.15) + 그림자 내는 Directional(`0xFFE6C0`, 2.3, 위치 `(7,14,-5)`), 그림자 전용 원 바닥 `ShadowMaterial({opacity:.28})`
  - `perf.js`: `createRenderer(canvas) -> renderer|null`(실패 시 null), `watchFps(renderer, world, onLow)`(3초 평균 40fps 미만이면 그림자 끔, pixelRatio 1)

- [ ] **Step 1: 실패하는 테스트 작성**

```js
// tests/calibrate.test.mjs (Node, vendor three, 렌더러 없이 투영만)
test('calibrationAcrossAspects', () => { for (const [W,H] of [[1120,700],[1366,768],[1024,768],[1280,800],[2000,1000]]) { const cam=new PerspectiveCamera(22,W/H,.1,500); const e=fitCamera(cam,W,H); const a=BG.a*Math.max(W/BG.w,H/BG.h); for (const v of [e.errX,e.errY,e.errA,e.errB]) assert.ok(Math.abs(v) < a*0.02, `${W}x${H} ${JSON.stringify(e)}`); } });
```

- [ ] **Step 2:** `npm test` → FAIL
- [ ] **Step 3:** `calibrate.js` 구현 → PASS
- [ ] **Step 4:** `world.js`, `perf.js` 구현. 임시 확인 페이지 `tests/e2e/scene.html`에서 시안 문제(높이 `[[2,2,2,1],[2,1,1,1]]`)를 띄운다.
- [ ] **Step 5:** `python tests/e2e/scene_shot.py` → `tests/e2e/out/scene.png`. 디버그 링(빨강, `?debugRing`)이 그림 속 금테 안쪽에 겹치는지, 조각 그림자가 바닥에 붙는지, 틈이 거의 안 보이는지 눈으로 확인한다.
- [ ] **Step 6:** 커밋 `feat: background-calibrated 3D scene with turntable`

---

### Task 7: 입력 (터치·마우스)

**Files:**
- Create: `src/scene/input.js`
- Test: `tests/e2e/input_test.py`

**Interfaces:**
- Consumes: Task 5 `movePiece`, `rotatePiece`, Task 6 `world.pickPiece`, `world.floorPoint`, `world.setSpin`, `world.updatePiece`
- Produces: `attachInput({canvas, stage, world, getPieces, setPiece(i, piece), onDrop(i), onSelect(i|null, clientXY), onRotate(i, axis)}) -> {detach(), resetSpin()}`
  - 조각 위 pointerdown → 선택. 8px 넘게 움직이면 끌기(판 좌표로 `movePiece`, 화면에서는 +0.35 띄움).
  - 8px 안에서 떼거나 450ms 길게 누르면 `onSelect(i, xy)`(링 버튼 표시용).
  - 빈 곳 pointerdown → 회전판(가로 이동량 × 0.008). 포인터가 2개면 두 포인터 평균 x로 회전.
  - 끌던 중 두 번째 포인터, `pointercancel`, `lostpointercapture`가 오면 마지막 칸에 내려놓고 `onDrop`.
  - 링 버튼 DOM: 돌리기(`'y'`), 세우기(`'x'`), 뒤집기(`'z'`). 클릭 → `onRotate`. 화면 가장자리에서 잘리지 않게 위치를 조정한다.

- [ ] **Step 1: 실패하는 e2e 작성** (`tests/e2e/input_test.py`, 페이지 `index.html?e2e&puzzle=proto`)
  - `drag_moves_piece`: 첫 조각 화면 좌표(`window.__ck.pieceScreenXY(0)`)에서 120px 끌기 → pos 변경
  - `drag_far_stays_inside`: 화면 모서리까지 끌기 → `__ck.fits(0)` true
  - `tap_opens_ring`: 조각 탭 → `#ring` 보임. 돌리기 클릭 → 조각 칸 바뀜
  - `empty_drag_spins`: 빈 곳 200px 끌기 → `__ck.spin()` ≠ 0, 조각 pos 그대로
  - `cancelMidDragLands`: 끌던 중 `pointercancel` 보냄 → 조각 `target.y`가 정수(뜬 상태 아님)
  - 터치 에뮬레이션(`has_touch=True`, `page.touchscreen`)과 마우스 둘 다 실행
- [ ] **Step 2:** FAIL 확인(Task 9에서 `?e2e` 훅이 생기기 전이면 Task 6 확인 페이지에 같은 훅을 붙여 실행)
- [ ] **Step 3:** 구현
- [ ] **Step 4:** PASS 확인
- [ ] **Step 5:** 커밋 `feat: touch and mouse input with turntable and rotate ring`

---

### Task 8: 화면 UI (시작·안내·게임 HUD·단서 카드·정답)

**Files:**
- Create: `index.html`, `styles/base.css`, `styles/screens.css`, `src/ui/screens.js`, `src/ui/hud.js`, `src/ui/clueCard.js`
- Test: `tests/e2e/ui_test.py`

**Interfaces:**
- Consumes: Task 2 `clueFor`, Task 4 상태 모양
- Produces:
  - `screens.js`: `showScreen('title'|'tutorial'|'game'|'win')`, `openTutorial({inputKind:'touch'|'mouse'})`, `onStart(cb)`, `onTutorialDone(cb, {dontShowAgain})`, `showWin({gained, base, speed, streak, mult, usedEasy, islandBefore, islandAfter, nextHint})`, `onNext(cb)`, 세로 화면 감시(`matchMedia('(orientation: portrait)')`) → `#rotateHint` 표시
  - `hud.js`: `renderHud({stage, levelName, streak, mult, score, island, toNext})`, `showBubble(text)`(2.5초), `setEasyAvailable(bool)`, `onTool(name:'reset'|'restart'|'skip'|'help'|'easy', cb)`
  - `clueCard.js`: `renderClue(el, clue)` — level 1: 안내 문구만, 2: 숫자 격자, 3: 1층·2층 격자, 4: 교과서 배치(위 / 그 아래 앞 / 앞 오른쪽 옆) 칸 2cqw. 카드 너비(18%) 안에서 넘치지 않아야 한다.
- 문구(고정):
  - 미션 `이 모양을 똑같이 쌓아요!`
  - 단계 이름 `1단계 · 3D 모양`, `2단계 · 위에서 본 모양`, `3단계 · 층별 단서`, `4단계 · 위·앞·옆`
  - 말풍선 `모양이 조금 달라요`
  - 쉬운 단서 버튼 `쉬운 단서 보기 (점수 절반)`
  - 세로 안내 `화면을 가로로 돌려 주세요`
  - WebGL 실패 `이 기기에서는 3D 화면을 켤 수 없어요. 다른 브라우저나 기기로 열어 주세요.`
  - 안내 카드: 터치 `조각을 손가락으로 끌어 판 위에 내려놓아요.` / `조각을 톡 누르면 돌리기·세우기·뒤집기 버튼이 나와요.` / `빈 곳을 끌면 판이 돌아가요. 두 손가락으로도 돌릴 수 있어요.`. 마우스 `조각을 마우스 왼쪽 버튼으로 끌어 판 위에 놓아요.` / `조각을 클릭하면 돌리기·세우기·뒤집기 버튼이 나와요.` / `빈 곳을 끌면 판이 돌아가요.`
  - 입력 종류 자동 감지: `matchMedia('(pointer: coarse)')` → touch
- 시각: `design/prototype/design-v2.html` ①②④와 `design-v4-game.html`의 CSS(칩, 금색 버튼, 입체 로고 `.lg`, 금테 카드, 단서 카드, 도구 버튼)를 그대로 옮기되, 섬은 배지(썸네일 + 남은 문제 + 진행 바)로 한다. 정답 화면 빛줄기·색종이는 `prefers-reduced-motion`이면 끈다.

- [ ] **Step 1: 실패하는 e2e 작성** (`ui_test.py`)
  - `title_to_tutorial_first_visit`: 저장소 비움 → 시작 → 안내 보임. "다음부터 보지 않기" 체크 후 시작 → 새로고침 → 시작 시 안내 안 보임
  - `tutorial_input_kind`: `has_touch` 컨텍스트 → 터치 탭 선택됨. 마우스 컨텍스트 → 마우스 탭
  - `clue_card_no_overflow`: 단서 4단계 카드의 모든 칸이 카드 박스 안(`getBoundingClientRect` 비교), 칸 한 변 ≥ 18px(1300px 너비)
  - `portraitWarning`: 뷰포트 600×900 → `#rotateHint` 보임
  - `buttons_min_48px`: 모든 `button`의 높이·너비 ≥ 44px(1024px 너비 기준)
- [ ] **Step 2:** FAIL → **Step 3:** 구현 → **Step 4:** PASS
- [ ] **Step 5:** 커밋 `feat: title, tutorial, game HUD, clue card and win screens`

---

### Task 9: 그림 자산 정리 + 게임 흐름 연결

**Files:**
- Create: `src/main.js`, `assets/img/*`, `assets/favicon.svg`
- Modify: `index.html`(스크립트 연결)
- Test: `tests/e2e/flow_test.py`

**Interfaces:**
- Consumes: Task 1~8 전부
- Produces: `?e2e` 쿼리일 때만 `window.__ck = {state(), puzzle(), pieces(), pieceScreenXY(i), fits(i), spin(), solveCurrent(), setPuzzle(idOrProto), elapsed(sec)}`. `solveCurrent`는 Task 3 `solve`의 첫 해답으로 조각을 옮기고 판정을 부른다.

- [ ] **Step 1:** 자산 복사: `design/prototype/`의 `title-bg.png`, `game-bg-v4.png`, `cubi-idle/cheer/think.png`, `island-1..4.png`, `tut-rotate.png` → `assets/img/`. `tut-drag`, `tut-view`는 마스코트 큐비(파란·흰 블록 아기 용)가 등장하게 다시 생성한다. 프롬프트는 `design/images-v2/image_prompts.json`의 해당 항목에 큐비 묘사를 더해 쓴다. 생성기: `python ~/.claude/skills/education-pptx/scripts/image_gen.py --manifest ... -o assets/img`, 키는 `~/docs/.env`의 `KIE_API_KEY`를 `KIE_AI_API_KEY`로 export. PNG는 Pillow로 긴 변 1600px 이하로 줄여 저장한다(배경 2장은 원본 크기 유지, 타원 값과 짝이기 때문).
- [ ] **Step 2: 실패하는 e2e 작성** (`flow_test.py`)
  - `solve_shows_win_and_scores`: `solveCurrent()` → 정답 화면, 점수 > 0, `다음 문제` → 새 문제, 섬 배지 남은 수 감소
  - `two_solves_promote_to_stage2`: 2번 풀기 → 단계 칩 `2단계 · 위에서 본 모양`, 단서 카드 숫자 격자
  - `all_on_board_wrong_shakes`: 모든 조각을 판 위에 틀리게 놓음 → 말풍선 `모양이 조금 달라요` 보임, 점수 변화 없음
  - `easy_hint_after_60s`: 2단계에서 `elapsed(61)` → 쉬운 단서 버튼 보임 → 누르면 1단계 단서, 풀면 점수 절반
  - `skip_lowers_streak`: 연속 3에서 건너뛰기 → 연속 2, 새 문제
  - `stage4_alt_shape_accepted`: 4단계에서 세 방향 모습만 같은 다른 모양을 만들 수 있는 문제(`setPuzzle` 고정 데이터)를 그 모양으로 채움 → 정답
  - `webgl_fail_message`: `--disable-webgl` 실행 → 실패 문구 보임, 오류로 멈추지 않음
- [ ] **Step 3:** FAIL → **Step 4:** `main.js` 구현
  - 문제는 현재 단계 은행에서 무작위로 고르되 최근 10개는 피한다.
  - 정답 판정은 끌기 놓음·회전 뒤에만 부른다.
  - 1초마다 경과 시간을 갱신하고 쉬운 단서 버튼을 표시한다.
  - 저장은 정답·건너뛰기 직후에 한다.
- [ ] **Step 5:** PASS 확인, `npm test` 전체 PASS
- [ ] **Step 6:** 커밋 `feat: wire full game flow and final art assets`

---

### Task 10: 최종 화면 검수 + 배포 준비

**Files:**
- Create: `tests/e2e/visual_review.py`, `README.md`
- Modify: 검수에서 나온 결함 파일만

**Interfaces:**
- Consumes: 완성된 앱

- [ ] **Step 1:** `visual_review.py`로 1366×768, 1280×800, 1024×768 세 크기에서 캡처한다(시작, 안내 터치·마우스, 게임 1~4단계 단서, 회전판 90° 돌린 상태, 정답 화면) → `tests/e2e/out/review/*.png`.
- [ ] **Step 2:** 캡처를 보고 스펙 7장 기준으로 점검한다.
  - 판이 작업대 정중앙에 있는가
  - 시작 조각이 판·UI를 가리지 않는가
  - 블록이 떠 보이지 않는가(그림자 접지)
  - 쌓기나무 틈
  - 단서 카드 넘침
  - 글자 겹침
  - 결함은 고치고 다시 캡처한다(최대 3회).
- [ ] **Step 3:** 저사양 모의: Edge 헤드리스 `--disable-gpu`(소프트웨어 렌더)로 게임 화면 10초 → 저사양 모드 전환 여부와 화면 정상 여부를 기록한다.
- [ ] **Step 4:** `README.md`
  - 실행: `python -m http.server`로 열기(파일을 직접 여는 `file://`은 ES 모듈 때문에 안 됨)
  - 테스트: `npm test`, `python tests/e2e/*.py`
  - 문제 은행 다시 만들기
  - 배경 교체 시 타원 다시 재기
  - GitHub Pages 배포 방법
  - 실제 저장소 생성·푸시·Pages 공개는 하지 않는다. 사용자 확인 후 진행한다.
- [ ] **Step 5:** 커밋 `chore: visual review fixes and README`
