"""Task 9 게임 흐름 e2e(정답·승급·흔들기·쉬운 단서·건너뛰기·4단계 다른 모양·WebGL 실패). Playwright + 시스템 Edge.

  python tests/e2e/flow_test.py [base_url]

base_url 을 주지 않으면 저장소 루트에서 http.server(8767)를 직접 띄우고 끝나면 닫는다.
화면 캡처는 tests/e2e/out/flow-*.png 로 남긴다(사람이 눈으로 확인).

시험 훅: index.html?e2e 이면 main.js 가 window.__ck 를 연다
  state(), puzzle(), pieces(), pieceScreenXY(i), fits(i), spin(), setSpin(r), solveCurrent(),
  setPuzzle(idOrProto) -> Promise, elapsed(sec), placeAll([{cells, pos}]), setProgress(patch)
"""
import json
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)
PORT = 8767
VIEW = {"width": 1280, "height": 800}

# 4단계 고정 문제: 2x2 판, 2층 칸이 대각선 두 곳. 대각선을 바꾼 모양(ALT)도 위·앞·옆 모습이 같다.
# 같은 모양 조각 두 개(ㄴ자 3칸)로 두 모양 모두 채울 수 있다.
ALT_PROTO = {
    "id": "alt-proto",
    "target": [[0, 0, 0], [1, 0, 0], [0, 0, 1], [1, 0, 1], [0, 1, 0], [1, 1, 1]],
    "pieces": [[[0, 0, 0], [0, 1, 0], [1, 0, 0]], [[0, 0, 0], [0, 1, 0], [1, 0, 0]]],
}
# ALT: 2층 칸이 (1,1,0), (0,1,1). 조각 칸은 조각 원점 기준, pos 는 판 좌표.
ALT_FILL = [
    {"cells": [[0, 0, 0], [1, 0, 0], [1, 1, 0]], "pos": [0, 0, 0]},
    {"cells": [[0, 0, 0], [0, 1, 0], [1, 0, 0]], "pos": [0, 0, 1]},
]

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


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


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"flow-{name}.png"))


def visible(page, sel):
    return page.locator(sel).first.is_visible()


def open_game(browser, base, launch_errors=None, ctx_opts=None, setup=None, wait_puzzle=True):
    """튜토리얼을 본 것으로 두고 시작 버튼을 눌러 첫 문제까지 연다."""
    ctx = browser.new_context(viewport=VIEW, **(ctx_opts or {}))
    page = ctx.new_page()
    if setup:
        setup(page)
    errors = [] if launch_errors is None else launch_errors
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{base}/index.html?e2e")
    page.evaluate("() => { localStorage.clear(); localStorage.setItem('ck.tutorialSeen', 'true'); }")
    page.reload()
    page.wait_for_function("() => window.__ckReady === true && window.__ck", timeout=15000)
    page.evaluate("document.fonts.ready")
    page.click("#startBtn")
    if wait_puzzle:
        page.wait_for_function("() => __ck.state().screen === 'game' && __ck.state().puzzleId", timeout=15000)
    page.wait_for_timeout(300)
    return ctx, page, errors


def state(page):
    return page.evaluate("__ck.state()")


def solve_shows_win_and_scores(browser, base):
    ctx, page, errors = open_game(browser, base)
    s0 = state(page)
    island0 = page.inner_text("#islandNext")
    page.evaluate("__ck.solveCurrent()")
    page.wait_for_timeout(500)
    win = visible(page, "#screen-win")
    s1 = state(page)
    gain = page.inner_text("#winGain")
    shot(page, "win")
    # 다음 문제를 두 번 눌러도 문제는 한 번만 바뀐다.
    page.evaluate("() => { const b = document.querySelector('#nextBtn'); b.click(); b.click(); }")
    page.wait_for_function("() => __ck.state().screen === 'game'", timeout=5000)
    page.wait_for_timeout(400)
    s2 = state(page)
    attempts = (int(s1["attemptId"].split("#")[1]), int(s2["attemptId"].split("#")[1]))
    island2 = page.inner_text("#islandNext")
    shot(page, "next")
    check("solve_shows_win_and_scores",
          win and s1["score"] > 0 and gain.startswith("+") and s2["puzzleId"] != s0["puzzleId"]
          and island0.endswith("5문제") and island2.endswith("4문제") and s2["solvedTotal"] == 1
          and attempts[1] == attempts[0] + 1 and not errors,
          f"win={win} score={s1['score']} gain={gain} ids={s0['puzzleId']}->{s2['puzzleId']} attempts={attempts} "
          f"island={island0!r}->{island2!r} errors={errors[:2]}")
    ctx.close()


def two_solves_promote_to_stage2(browser, base):
    ctx, page, errors = open_game(browser, base)
    for _ in range(2):
        page.evaluate("__ck.solveCurrent()")
        page.wait_for_function("() => __ck.state().screen === 'win'", timeout=5000)
        page.wait_for_timeout(300)
        page.click("#nextBtn")
        page.wait_for_function("() => __ck.state().screen === 'game'", timeout=5000)
    page.wait_for_timeout(400)
    stage_text = page.inner_text("#stageText")
    level = page.get_attribute("#clueBody", "data-level")
    nums = page.evaluate("() => [...document.querySelectorAll('#clueBody .g > div')].filter(e => /^\\d+$/.test(e.textContent)).length")
    pid = state(page)["puzzleId"]
    shot(page, "stage2")
    check("two_solves_promote_to_stage2",
          stage_text == "2단계 · 위에서 본 모양" and level == "2" and nums > 0 and pid.startswith("s2-") and not errors,
          f"stage={stage_text!r} level={level} nums={nums} id={pid} errors={errors[:2]}")
    ctx.close()


def all_on_board_wrong_shakes(browser, base):
    ctx, page, errors = open_game(browser, base)
    # 1단계(목표 칸과 같아야 함)에서 다른 모양으로 판을 모두 채운다.
    page.evaluate(f"__ck.setPuzzle({json.dumps(ALT_PROTO)})")
    page.wait_for_timeout(200)
    before = state(page)
    page.evaluate(f"__ck.placeAll({json.dumps(ALT_FILL)})")
    page.wait_for_timeout(250)
    bubble_on = page.evaluate("() => document.querySelector('#bubble').classList.contains('on')")
    text = page.inner_text("#bubbleText")
    after = state(page)
    shot(page, "mismatch")
    page.click("[data-tool=skip]")
    page.wait_for_function("() => __ck.state().puzzleId !== 'alt-proto'", timeout=5000)
    bubble_after_skip = page.evaluate("() => document.querySelector('#bubble').classList.contains('on')")
    check("all_on_board_wrong_shakes",
          bubble_on and text == "모양이 조금 달라요" and after["score"] == before["score"]
          and after["screen"] == "game" and after["streak"] == before["streak"] and after["shakes"] == before["shakes"] + 1
          and not bubble_after_skip and not errors,
          f"bubble={bubble_on} text={text!r} score={before['score']}->{after['score']} shakes={after['shakes']} "
          f"bubble_after_skip={bubble_after_skip} errors={errors[:2]}")
    ctx.close()


def easy_hint_after_60s(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__ck.setProgress({stage: 2})")
    page.evaluate("__ck.setPuzzle('s2-001')")
    page.wait_for_timeout(200)
    hidden_at_start = not visible(page, "#easyBtn")
    page.evaluate("__ck.elapsed(30)")
    hidden_at_30 = not visible(page, "#easyBtn")
    page.evaluate("__ck.elapsed(61)")
    page.wait_for_timeout(100)
    shown = visible(page, "#easyBtn")
    shot(page, "easy-button")
    page.click("#easyBtn")
    page.wait_for_timeout(200)
    st = state(page)
    level_attr = page.get_attribute("#clueBody", "data-level")
    lvl_text = page.inner_text("#clueLevel")
    ghost = page.evaluate("__ck.ghostVisible()")
    btn_gone = not visible(page, "#easyBtn")
    shot(page, "easy-clue")
    page.evaluate("__ck.solveCurrent()")
    page.wait_for_timeout(400)
    s2 = state(page)
    calc = page.inner_text("#winCalc")
    # 연속 1 · 61초 · 쉬운 단서: (100 + 0) × 1 × 0.5 = 50
    check("easy_hint_after_60s",
          hidden_at_start and hidden_at_30 and shown and st["level"] == 1 and st["usedEasy"] and level_attr == "1"
          and lvl_text.startswith("쉬운 단서") and ghost and btn_gone and s2["score"] == 50 and "쉬운 단서" in calc
          and s2["stage"] == 2 and not errors,
          f"start_hidden={hidden_at_start} 30s_hidden={hidden_at_30} shown={shown} level={st['level']} attr={level_attr} "
          f"text={lvl_text!r} ghost={ghost} score={s2['score']} stage={s2['stage']} errors={errors[:2]}")
    ctx.close()


def skip_lowers_streak(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__ck.setProgress({streak: 3})")
    s0 = state(page)
    page.click("[data-tool=skip]")
    page.wait_for_timeout(400)
    s1 = state(page)
    combo = page.inner_text("#comboText")
    check("skip_lowers_streak",
          s0["streak"] == 3 and s1["streak"] == 2 and combo.startswith("2연속") and s1["puzzleId"] != s0["puzzleId"]
          and s1["score"] == s0["score"] and not errors,
          f"streak={s0['streak']}->{s1['streak']} combo={combo!r} ids={s0['puzzleId']}->{s1['puzzleId']} errors={errors[:2]}")
    ctx.close()


def stage4_alt_shape_accepted(browser, base):
    ctx, page, errors = open_game(browser, base)
    page.evaluate("__ck.setProgress({stage: 4})")
    page.evaluate(f"__ck.setPuzzle({json.dumps(ALT_PROTO)})")
    page.wait_for_timeout(200)
    st = state(page)
    page.evaluate(f"__ck.placeAll({json.dumps(ALT_FILL)})")
    page.wait_for_timeout(400)
    s1 = state(page)
    win = visible(page, "#screen-win")
    check("stage4_alt_shape_accepted",
          st["level"] == 4 and win and s1["score"] > 0 and not errors,
          f"level={st['level']} win={win} score={s1['score']} errors={errors[:2]}")
    ctx.close()


def help_keeps_puzzle(browser, base):
    ctx, page, errors = open_game(browser, base)
    before = page.evaluate("JSON.stringify({id: __ck.state().attemptId, p: __ck.pieces().map(p => [p.cells, p.pos])})")
    page.click("[data-tool=help]")
    page.wait_for_timeout(300)
    tut = visible(page, "#screen-tutorial")
    # 도움말이 열린 동안 경과 시간이 멈춘다(R16b).
    e0 = state(page)
    page.wait_for_timeout(1500)
    e1 = state(page)
    page.click("#tutDone")
    page.wait_for_timeout(1000)
    e2 = state(page)
    after = page.evaluate("JSON.stringify({id: __ck.state().attemptId, p: __ck.pieces().map(p => [p.cells, p.pos])})")
    paused_ok = e0["paused"] and e1["paused"] and abs(e1["elapsed"] - e0["elapsed"]) < 0.01
    resumed_ok = not e2["paused"] and 0.7 < e2["elapsed"] - e1["elapsed"] < 2.0
    check("help_keeps_puzzle", tut and before == after and visible(page, "#screen-game") and not errors,
          f"tut={tut} same={before == after} errors={errors[:2]}")
    check("help_pauses_timer", paused_ok and resumed_ok,
          f"elapsed {e0['elapsed']:.2f} -> {e1['elapsed']:.2f} (paused) -> {e2['elapsed']:.2f}")
    ctx.close()


def drag_then_skip_is_safe(browser, base):
    """터치로 조각을 끄는 중에 건너뛰기 → 남은 이동·떼기가 새 문제를 망가뜨리지 않는다."""
    ctx, page, errors = open_game(browser, base, ctx_opts={"has_touch": True})
    cdp = ctx.new_cdp_session(page)
    s0 = state(page)
    x, y = page.evaluate("[__ck.pieceScreenXY(0).x, __ck.pieceScreenXY(0).y]")

    def touch(kind, pts):
        cdp.send("Input.dispatchTouchEvent", {"type": kind,
                 "touchPoints": [{"x": px, "y": py, "id": 0} for (px, py) in pts]})

    touch("touchStart", [(x, y)])
    for k in range(1, 6):
        touch("touchMove", [(x + 12 * k, y)])
        page.wait_for_timeout(16)
    page.evaluate("() => document.querySelector('[data-tool=skip]').click()")
    page.wait_for_function("(a) => __ck.state().attemptId !== a", arg=s0["attemptId"], timeout=5000)
    snap = page.evaluate("JSON.stringify(__ck.pieces())")
    for k in range(6, 14):
        touch("touchMove", [(x + 12 * k, y + 4 * k)])
        page.wait_for_timeout(16)
    touch("touchEnd", [])
    page.wait_for_timeout(400)
    after = page.evaluate("JSON.stringify(__ck.pieces())")
    s1 = state(page)
    fits_all = page.evaluate("__ck.pieces().every((_, i) => __ck.fits(i))")
    ring = page.evaluate("__ck.input.ringState().visible")
    check("drag_then_skip_is_safe",
          s1["puzzleId"] != s0["puzzleId"] and snap == after and fits_all and not ring and not errors,
          f"ids={s0['puzzleId']}->{s1['puzzleId']} intact={snap == after} fits={fits_all} ring={ring} errors={errors[:2]}")
    ctx.close()


def load_failure_retry(browser, base):
    """문제 은행을 한 번 못 받으면 안내 카드가 뜨고, 다시 불러오기로 이어서 할 수 있다."""
    fails = {"n": 0}

    def setup(page):
        def handler(route):
            if fails["n"] == 0:
                fails["n"] += 1
                route.fulfill(status=503, body="busy")
            else:
                route.continue_()
        page.route("**/data/puzzles-s1.json", handler)

    ctx, page, errors = open_game(browser, base, setup=setup, wait_puzzle=False)
    page.wait_for_function("() => __ck.state().loadFailed", timeout=8000)
    card = visible(page, "#loadFail")
    text = page.inner_text("#loadFail")
    shot(page, "load-fail")
    s0 = state(page)
    page.click("#loadFail [data-tool=retry]")
    page.wait_for_function("() => __ck.state().puzzleId", timeout=8000)
    page.wait_for_timeout(200)
    s1 = state(page)
    card_after = visible(page, "#loadFail")
    check("load_failure_retry",
          card and "문제를 불러오지 못했어요" in text and s0["puzzleId"] is None and bool(s1["puzzleId"])
          and not s1["loadFailed"] and not card_after and s1["streak"] == 0 and fails["n"] == 1 and not errors,
          f"card={card} id={s0['puzzleId']}->{s1['puzzleId']} card_after={card_after} fails={fails['n']} errors={errors[:2]}")
    ctx.close()


def webgl_fail_message(base):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge", args=["--disable-webgl", "--disable-webgl2", "--disable-3d-apis"])
        try:
            errors = []
            ctx, page, _ = open_game(browser, base, errors)
            shown = visible(page, "#glFail")
            st = state(page)
            shot(page, "webgl-fail")
            page.click("[data-tool=skip]")
            page.wait_for_timeout(300)
            st2 = state(page)
            check("webgl_fail_message",
                  shown and st["webgl"] is False and st2["puzzleId"] != st["puzzleId"] and not errors,
                  f"shown={shown} webgl={st['webgl']} ids={st['puzzleId']}->{st2['puzzleId']} errors={errors[:2]}")
            ctx.close()
        finally:
            browser.close()


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else None
    server = None
    if base is None:
        server = start_server()
        base = f"http://localhost:{PORT}"
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            try:
                for fn in (solve_shows_win_and_scores, two_solves_promote_to_stage2, all_on_board_wrong_shakes,
                           easy_hint_after_60s, skip_lowers_streak, stage4_alt_shape_accepted, help_keeps_puzzle,
                           drag_then_skip_is_safe, load_failure_retry):
                    try:
                        fn(browser, base)
                    except Exception as e:  # 한 시험이 죽어도 나머지는 돈다
                        check(fn.__name__, False, f"error: {str(e).splitlines()[0][:200]}")
                        for c in list(browser.contexts):
                            c.close()
            finally:
                browser.close()
        try:
            webgl_fail_message(base)
        except Exception as e:
            check("webgl_fail_message", False, f"error: {str(e).splitlines()[0][:200]}")
    finally:
        if server:
            server.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
