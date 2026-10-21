# 큐브 왕국 건축가

초등 6학년 2학기 3단원 "공간과 입체"를 위한 3D 쌓기나무 퍼즐 웹앱입니다.
조각을 끌어 판 위에 쌓아 단서(3D 모양, 위에서 본 모양·수, 층별, 위·앞·옆)와 같은 모양을 만듭니다.
빌드 도구 없이 HTML + CSS + ES 모듈로 되어 있고, three.js(r160)는 `vendor/three/` 에 들어 있습니다.

설계 문서는 `docs/superpowers/specs/2026-10-21-cube-kingdom-design.md`, 시안은 `design/prototype/` 에 있습니다.

## 실행

저장소 폴더에서 정적 서버를 띄우고 브라우저로 엽니다.

```
python -m http.server 8000
```

그다음 `http://localhost:8000/index.html` 을 엽니다.

`index.html` 을 더블클릭해 `file://` 로 열면 동작하지 않습니다. ES 모듈과 문제 은행 `fetch` 가 파일 주소에서는 막히기 때문입니다.

- 가로 화면 기준(1024×768 이상)으로 만들었습니다. 세로로 열면 가로로 돌려 달라는 안내가 나옵니다.
- 기록은 이 기기의 `localStorage` 에만 저장됩니다.
- `index.html?e2e` 로 열면 시험용 훅(`window.__ck`, `window.__ckUi`)이 열립니다. 배포 주소에서는 쓰지 않습니다.

## 시험

단위 테스트(Node만 있으면 됩니다):

```
npm test
```

`node --test --test-isolation=none "tests/**/*.test.mjs"` 를 돌립니다.

화면 시험(Playwright + 시스템 Edge, `pip install playwright` 필요):

```
python tests/e2e/flow_test.py       # 게임 흐름(정답 판정, 점수, 단계, 저장)
python tests/e2e/ui_test.py         # 시작·안내·HUD·단서 카드·정답 화면
python tests/e2e/visual_review.py   # 3개 화면 크기 검수 캡처 -> tests/e2e/out/review/
python tests/e2e/visual_review.py --lowend   # --disable-gpu 로 저사양 모드 전환 확인
```

- 메모리가 적은 PC에서는 **한 번에 하나씩** 돌리고, 끝나면 Edge가 닫혔는지 확인하세요.
- 스크립트가 아무 말 없이 죽으면(종료 코드 127) `TEMP`, `TMP` 환경 변수를 짧은 영문 경로(예: `C:\Users\Public\tmp-ck`)로 지정하세요.
- `flow_test.py`, `ui_test.py`, `visual_review.py` 는 스스로 서버를 띄웁니다. `input_test.py`, `scene_shot.py` 는 `python -m http.server 8765` 를 먼저 띄워 두어야 합니다.
- 캡처는 `tests/e2e/out/` 에 쌓이며 git 에는 올라가지 않습니다.

## 문제 은행 다시 만들기

문제는 `data/puzzles-s1.json` ~ `s4.json`(단계당 40문제)에 들어 있습니다. 목표 모양을 먼저 만들고 조각으로 쪼갠 뒤 해답 탐색기로 풀리는지 확인하는 방식(거꾸로 만들기)입니다. 시드가 고정되어 있어 같은 코드면 같은 결과가 나옵니다.

```
node tools/gen-puzzles.mjs        # data/puzzles-s1..4.json 다시 만들기
python tools/preview-sheet.py     # design/review/puzzles-s1..4.png 미리보기(Pillow 필요)
```

미리보기 그림을 눈으로 보고 단조롭거나 이상한 문제를 거릅니다. 바꾼 뒤에는 `npm test` 를 돌리세요(전 문항의 풀림·시작 배치를 검사합니다).

## 배경 그림을 바꿀 때

게임 화면 배경(`assets/img/game-bg-v4.webp`, 정답 화면 배경도 같은 그림)은 3D 카메라와 짝입니다. 카메라는 그림 속 원형 작업대 금테 안쪽 타원에 맞춰 보정됩니다. **배경을 다시 생성하거나 바꾸면 타원을 다시 재야 합니다.**

1. 새 그림에서 작업대 금테 안쪽 타원의 중심(cx, cy)과 가로·세로 반지름(a, b)을 픽셀로 잽니다.
2. `src/scene/calibrate.js` 의 `BG` 상수(그림 크기 w·h, cx, cy, a, b)를 바꿉니다. 파일 이름이 달라지면 `styles/screens.css` 의 `game-bg-v4.webp` 두 곳도 바꿉니다.
3. `npm test` 의 보정 시험(`calibrate.test.mjs`)이 오차 2% 안인지 확인합니다.
4. `python tests/e2e/visual_review.py` 로 세 크기를 캡처해, 판이 작업대 위에 놓이고 금테 경계와 맞는지 눈으로 확인합니다.

## GitHub Pages 배포 방법

빌드 과정이 없어 저장소 파일이 그대로 배포됩니다. 아래는 절차 설명이며, 저장소 만들기·푸시·공개는 사용자가 확인한 뒤에 합니다.

1. GitHub 계정(989-alt)에 새 저장소를 만듭니다. 저장소 이름이 곧 주소(`https://989-alt.github.io/<저장소 이름>/`)가 되므로 이름을 먼저 정합니다.
2. 작업 브랜치를 `main` 으로 합쳐 푸시합니다. 저장소에는 `index.html`, `src/`, `styles/`, `assets/`, `data/`, `vendor/` 가 있어야 합니다. 시험·시안·문서 폴더는 올려도 동작에는 영향이 없습니다.
3. 저장소의 Settings → Pages 에서 Source 를 "Deploy from a branch", Branch 를 `main` / `(root)` 로 저장합니다.
4. 1~2분 뒤 위 주소로 열립니다. 주소는 `/` 로 끝나는 하위 경로라서, 코드의 모든 경로는 `index.html` 기준 상대 경로여야 합니다(현재 그렇게 되어 있습니다).
5. 배포 후 확인: 시작 화면 → 안내 → 게임 → 정답까지 한 번 돌려 보고, 글꼴(Jua, Pretendard)이 막힌 학교망에서는 시스템 글꼴로 대체되는지 확인합니다.
6. 학생 검증을 위해 링크를 미리 배포·공유하지 않습니다(재방문 측정이 어려워집니다).

## 폴더

```
index.html        화면 틀과 아이콘
src/core/         순수 JS(문제 판정, 해답 탐색, 시작 배치, 점수·진행, 저장) - 브라우저 API 없음
src/scene/        three.js 장면(카메라 보정, 회전판, 조각, 입력, 저사양 감시)
src/ui/           화면 UI(시작·안내·HUD·단서 카드·정답)
src/main.js       게임 흐름
styles/           CSS
data/             문제 은행
tools/            문제 은행 생성기, 미리보기
tests/            단위 테스트(*.test.mjs)와 화면 시험(e2e/*.py)
```
