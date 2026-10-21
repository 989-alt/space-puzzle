"""Task 10 최종 화면 검수 캡처(Playwright + 시스템 Edge).

  python tests/e2e/visual_review.py [base_url] [--lowend]

base_url 을 주지 않으면 저장소 루트에서 http.server(8767)를 직접 띄우고 끝나면 닫는다.
1366x768, 1280x800, 1024x768 세 크기에서 화면을 찍어 tests/e2e/out/review/<크기>-<이름>.png 로 남긴다.
  시작, 안내(터치/마우스), 게임 1~4단계, 회전판 90도, 정답
같이 객관 점검(조각이 HUD·단서 카드·도구를 가리는지, 글자 넘침, 판 중심과 작업대 타원 중심)도 출력한다.

--lowend 이면 Edge 를 --disable-gpu(소프트웨어 렌더)로 띄워 게임 화면 15초 동안 저사양 모드 전환 여부를 기록한다.
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out", "review")
os.makedirs(OUT, exist_ok=True)

SIZES = [(1366, 768), (1280, 800), (1024, 768)]
PORT = 8767

# 조각이 가리면 안 되는 UI 요소(화면 좌표 사각형)
UI_RECTS_JS = """() => {
  const sel = ['#stageChip', '#comboChip', '#islandBadge', '.mission', '.score', '#clueCard', '.tools', '#bubble'];
  const out = [];
  for (const s of sel) {
    const e = document.querySelector(s);
    if (!e || e.hidden) continue;
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    out.push({ s, l: r.left, t: r.top, r: r.right, b: r.bottom });
  }
  return out;
}"""

# 글자가 칸 밖으로 넘치는지(보이는 요소 중 scrollWidth 가 clientWidth 를 넘는 것)
CLIP_JS = """() => {
  const bad = [];
  for (const e of document.querySelectorAll('.screen.on *')) {
    if (!(e instanceof HTMLElement)) continue;
    const cs = getComputedStyle(e);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (!e.textContent.trim() || e.children.length > 0 && !e.matches('button,span,b,small,p,div')) continue;
    if (e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.overflow !== 'visible') {
      bad.push({ el: (e.id || e.className || e.tagName) + ':' + e.textContent.trim().slice(0, 16), sw: e.scrollWidth, cw: e.clientWidth });
    }
  }
  // 모든 요소가 화면 안에 있는지
  const off = [];
  for (const e of document.querySelectorAll('.screen.on button, .screen.on .chip, .screen.on .clue, .screen.on .score, .screen.on .island')) {
    const r = e.getBoundingClientRect();
    if (r.width < 2) continue;
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) off.push((e.id || e.className) + '');
  }
  return { clip: bad, off };
}"""


def start_server():
    proc = subprocess.Popen([sys.executable, "-m", "http.server", str(PORT)], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen(f"http://localhost:{PORT}/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.1)
    return proc


def ready(page):
    page.wait_for_function("() => window.__ckReady === true", timeout=15000)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(200)


def settle(page, ms=1400):
    """조각이 떨어져 내려앉고 목표 빛이 한 박자 도는 시간."""
    page.wait_for_timeout(ms)


def shot(page, size, name):
    page.screenshot(path=os.path.join(OUT, f"{size[0]}x{size[1]}-{name}.png"))


def report_ui(page, size, name):
    """화면 점검 줄 출력."""
    r = page.evaluate(CLIP_JS)
    line = f"[{size[0]}x{size[1]}] {name}: clip={r['clip']} off={r['off']}"
    print(line)
    return r


def overlap_report(page, size, name):
    """조각 화면 위치(중심)가 UI 사각형 안에 있는지."""
    rects = page.evaluate(UI_RECTS_JS)
    n = len(page.evaluate("() => window.__ck.pieces()"))
    hits = []
    for i in range(n):
        xy = page.evaluate(f"() => window.__ck.pieceScreenXY({i})")
        if not xy:
            continue
        for rc in rects:
            if rc["l"] <= xy["x"] <= rc["r"] and rc["t"] <= xy["y"] <= rc["b"]:
                hits.append((i, rc["s"], round(xy["x"]), round(xy["y"])))
    print(f"[{size[0]}x{size[1]}] {name}: piece-under-ui={hits}")
    return hits


def board_center_report(page, size):
    """판 중심(0,0,0 근처 작업대 중심)의 화면 좌표와 배경 작업대 타원 중심 비교."""
    r = page.evaluate("""() => {
      const w = innerWidth, h = innerHeight, BG = { w: 1344, h: 768, cx: 672, cy: 418 };
      const s = Math.max(w / BG.w, h / BG.h);
      const ex = (w - BG.w * s) / 2 + BG.cx * s, ey = (h - BG.h * s) / 2 + BG.cy * s;
      const c = window.__ck.world.center();
      const p = window.__ck.project(c.x, 0, c.z);
      return { ex, ey, px: p.x, py: p.y };
    }""")
    print(f"[{size[0]}x{size[1]}] board-center=({r['px']:.0f},{r['py']:.0f}) ellipse-center=({r['ex']:.0f},{r['ey']:.0f}) d=({r['px']-r['ex']:.0f},{r['py']-r['ey']:.0f})")
    return r


def run_size(browser, base, size):
    w, h = size
    errors = []
    # 시작·안내(터치/마우스) — 첫 접속
    for label, opts in (("touch", {"has_touch": True, "is_mobile": False}), ("mouse", {})):
        ctx = browser.new_context(viewport={"width": w, "height": h}, **opts)
        page = ctx.new_page()
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: m.type == "error" and errors.append(m.text))
        page.goto(f"{base}/index.html?e2e")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        ready(page)
        if label == "mouse":
            shot(page, size, "01-title")
            report_ui(page, size, "title")
        page.click("#startBtn")
        page.wait_for_timeout(500)
        shot(page, size, f"02-tutorial-{label}")
        report_ui(page, size, f"tutorial-{label}")
        ctx.close()

    # 게임 1~4단계
    ctx = browser.new_context(viewport={"width": w, "height": h})
    page = ctx.new_page()
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => localStorage.clear()")
    page.reload()
    ready(page)
    page.evaluate("() => window.__ckUi.showScreen('game')")
    ids = {1: "s1-001", 2: "s2-001", 3: "s3-001", 4: "s4-001"}
    for stage in (1, 2, 3, 4):
        page.evaluate(f"() => window.__ck.setProgress({{stage: {stage}, streak: {stage}, score: {stage * 310}}})")
        page.evaluate(f"async () => {{ await window.__ck.setPuzzle('{ids[stage]}'); }}")
        settle(page)
        shot(page, size, f"03-game-stage{stage}")
        report_ui(page, size, f"game-stage{stage}")
        overlap_report(page, size, f"game-stage{stage}")
        if stage == 1:
            board_center_report(page, size)
    # 회전판 90도 (4단계 문제 그대로)
    page.evaluate("() => window.__ck.setSpin(Math.PI / 2)")
    settle(page, 700)
    shot(page, size, "04-game-spin90")
    report_ui(page, size, "spin90")
    page.evaluate("() => window.__ck.setSpin(0)")
    # 정답 화면(실제 해답으로)
    page.evaluate("() => window.__ck.setProgress({stage: 2, streak: 3, score: 600})")
    page.evaluate("async () => { await window.__ck.setPuzzle('s2-001'); }")
    settle(page, 500)
    ok = page.evaluate("() => window.__ck.solveCurrent()")
    page.wait_for_timeout(1300)
    shot(page, size, "05-win")
    report_ui(page, size, "win")
    scr = page.evaluate("() => window.__ck.state().screen")
    print(f"[{w}x{h}] win solved={ok} screen={scr}")
    if errors:
        print(f"[{w}x{h}] ERRORS: {errors[:5]}")
    ctx.close()
    return errors


def run_lowend(base):
    """소프트웨어 렌더(--disable-gpu)로 게임 화면 15초."""
    out = {}
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", args=["--disable-gpu"])
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, device_scale_factor=2)
        page = ctx.new_page()
        errs = []
        page.on("pageerror", lambda e: errs.append(str(e)))
        page.goto(f"{base}/index.html?e2e")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        ready(page)
        out["webgl"] = page.evaluate("() => window.__ck.state().webgl")
        # 실제 흐름으로 들어가야 저사양 감시(watchFps)가 켜진다: 시작 -> 안내 -> 게임
        page.click("#startBtn")
        page.wait_for_timeout(300)
        page.click("#tutDone")
        page.wait_for_timeout(300)
        page.evaluate("""() => { window.__fpsLog = []; let last = performance.now(), n = 0;
          const loop = (t) => { n++; if (t - last >= 1000) { window.__fpsLog.push(n); n = 0; last = t; } requestAnimationFrame(loop); };
          requestAnimationFrame(loop); }""")
        probe = """() => { const c = document.getElementById('c'); const r = c.getBoundingClientRect();
          return { ratio: c.width / r.width, shadows: window.__ck.world ? true : null }; }"""
        out["ratio_start"] = page.evaluate(probe)["ratio"]
        # 15초 동안 1초마다 픽셀 비율 기록(소프트웨어 렌더는 6fps 안팎이라 시작 후 30프레임 + 3초 구간이 걸린다)
        series = []
        for _ in range(15):
            page.wait_for_timeout(1000)
            series.append(round(page.evaluate(probe)["ratio"], 2))
        out["ratio_series"] = series
        out["fps_per_sec"] = page.evaluate("() => window.__fpsLog")
        out["low_mode_switched"] = series[-1] <= 1.01 and out["ratio_start"] > 1.01
        out["switched_at_sec"] = next((i + 1 for i, r in enumerate(series) if r <= 1.01), None)
        page.wait_for_timeout(300)
        page.screenshot(path=os.path.join(OUT, "lowend-game.png"))
        out["screen"] = page.evaluate("() => window.__ck.state().screen")
        out["errors"] = errs
        browser.close()
    print("LOWEND", json.dumps(out, ensure_ascii=False))
    return out


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = args[0] if args else None
    server = None
    if base is None:
        server = start_server()
        base = f"http://localhost:{PORT}"
    all_errors = []
    try:
        if "--lowend" in sys.argv:
            run_lowend(base)
            return
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            try:
                for size in SIZES:
                    all_errors += run_size(browser, base, size)
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
    print("OK" if not all_errors else f"console/page errors: {all_errors[:5]}")
    sys.exit(1 if all_errors else 0)


if __name__ == "__main__":
    main()
