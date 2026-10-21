"""Task 8 화면 UI(시작·안내·게임 HUD·단서 카드·정답) e2e. Playwright + 시스템 Edge.

  python tests/e2e/ui_test.py [base_url]

base_url 을 주지 않으면 저장소 루트에서 http.server(8766)를 직접 띄우고 끝나면 닫는다.
화면 캡처는 tests/e2e/out/ui-*.png 로 남긴다(사람이 눈으로 확인).

시험 훅: index.html?e2e 이면 main.js 가 window.__ckUi 를 연다
  showScreen(name), showWin(data), renderHud(data), showPuzzle(id, level) -> Promise
"""
import os
import subprocess
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)

results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""))


def start_server():
    proc = subprocess.Popen([sys.executable, "-m", "http.server", "8766"], cwd=ROOT,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    for _ in range(50):
        try:
            urllib.request.urlopen("http://localhost:8766/index.html", timeout=1)
            return proc
        except Exception:
            time.sleep(0.1)
    return proc


def ready(page):
    page.wait_for_function("() => window.__ckReady === true", timeout=10000)
    page.evaluate("document.fonts.ready")
    page.wait_for_timeout(150)


def shot(page, name):
    page.screenshot(path=os.path.join(OUT, f"ui-{name}.png"))


def visible(page, sel):
    return page.locator(sel).first.is_visible()


def title_to_tutorial_first_visit(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(f"{base}/index.html")
    page.evaluate("() => localStorage.clear()")
    page.reload()
    ready(page)
    shot(page, "title")
    page.click("#startBtn")
    page.wait_for_timeout(200)
    first = visible(page, "#screen-tutorial")
    page.click("label.dont")
    checked = page.is_checked("#dontShow")
    page.click("#tutDone")
    page.wait_for_timeout(200)
    in_game = visible(page, "#screen-game")
    page.reload()
    ready(page)
    page.click("#startBtn")
    page.wait_for_timeout(200)
    second_tut = visible(page, "#screen-tutorial")
    second_game = visible(page, "#screen-game")
    # 도움말은 안내를 다시 연다
    page.click("[data-tool=help]")
    page.wait_for_timeout(200)
    help_tut = visible(page, "#screen-tutorial")
    check("title_to_tutorial_first_visit",
          first and checked and in_game and not second_tut and second_game and help_tut,
          f"first={first} game={in_game} second_tut={second_tut} second_game={second_game} help={help_tut}")
    ctx.close()


def tutorial_input_kind(browser, base):
    kinds = {}
    for label, opts in (("touch", {"has_touch": True, "is_mobile": False}), ("mouse", {})):
        ctx = browser.new_context(viewport={"width": 1280, "height": 800}, **opts)
        page = ctx.new_page()
        page.goto(f"{base}/index.html")
        page.evaluate("() => localStorage.clear()")
        page.reload()
        ready(page)
        page.click("#startBtn")
        page.wait_for_timeout(300)
        on = page.evaluate("() => document.querySelector('.seg [aria-pressed=true]')?.dataset.kind")
        text = page.inner_text("#screen-tutorial .panels")
        kinds[label] = (on, text)
        shot(page, f"tutorial-{label}")
        # 토글을 누르면 문구가 바뀐다
        other = "mouse" if label == "touch" else "touch"
        page.click(f".seg [data-kind={other}]")
        page.wait_for_timeout(100)
        kinds[label + "-toggled"] = page.inner_text("#screen-tutorial .panels")
        ctx.close()
    touch_ok = kinds["touch"][0] == "touch" and "조각을 손가락으로 끌어 판 위에 내려놓아요." in kinds["touch"][1].replace("\n", " ").replace("  ", " ")
    mouse_ok = kinds["mouse"][0] == "mouse" and "조각을 마우스 왼쪽 버튼으로 끌어 판 위에 놓아요." in kinds["mouse"][1].replace("\n", " ").replace("  ", " ")
    toggle_ok = "마우스" in kinds["touch-toggled"] and "손가락" in kinds["mouse-toggled"]
    check("tutorial_input_kind", touch_ok and mouse_ok and toggle_ok,
          f"touch={kinds['touch'][0]} mouse={kinds['mouse'][0]} toggle={toggle_ok}")


OVERFLOW_JS = """() => {
  const card = document.querySelector('#clueCard').getBoundingClientRect();
  const cells = [...document.querySelectorAll('#clueCard .g > div')].map(e => e.getBoundingClientRect());
  let out = 0, minSide = 1e9;
  for (const r of cells) {
    if (r.left < card.left - 0.5 || r.right > card.right + 0.5 || r.top < card.top - 0.5 || r.bottom > card.bottom + 0.5) out++;
    minSide = Math.min(minSide, r.width, r.height);
  }
  const tools = document.querySelector('.tools').getBoundingClientRect();
  return { n: cells.length, out, minSide, cardBottom: card.bottom, toolsTop: tools.top };
}"""


def clue_card_no_overflow(browser, base):
    ctx = browser.new_context(viewport={"width": 1300, "height": 812})
    page = ctx.new_page()
    page.goto(f"{base}/index.html?e2e")
    ready(page)
    page.evaluate("() => window.__ckUi.showScreen('game')")
    bad = []
    worst = 1e9
    for stage, level in ((4, 4), (3, 3), (2, 2)):
        ids = page.evaluate(f"async () => (await (await fetch('data/puzzles-s{stage}.json')).json()).map(p => p.id)")
        for pid in ids:
            page.evaluate(f"() => window.__ckUi.showPuzzle('{pid}', {level})")
            r = page.evaluate(OVERFLOW_JS)
            if r["n"] == 0 or r["out"] or r["cardBottom"] > r["toolsTop"]:
                bad.append((pid, level, r))
            if level == 4:
                worst = min(worst, r["minSide"])
    check("clue_card_no_overflow", not bad and worst >= 18,
          f"bad={bad[:3]} min_cell_level4={worst:.1f}px")
    for level, pid in ((1, "s1-001"), (2, "s2-001"), (3, "s3-001"), (4, "s4-001")):
        page.evaluate(f"() => window.__ckUi.showPuzzle('{pid}', {level})")
        page.evaluate(f"""() => window.__ckUi.renderHud({{stage:{level}, streak:4, mult:2, score:1240, island:1, toNext:3}})""")
        page.wait_for_timeout(100)
        shot(page, f"game-level{level}")
    page.evaluate("() => { window.__ckUi.setEasyAvailable(true); window.__ckUi.showBubble('모양이 조금 달라요'); }")
    page.wait_for_timeout(400)
    shot(page, "game-bubble-easy")
    ctx.close()


def portrait_warning(browser, base):
    ctx = browser.new_context(viewport={"width": 600, "height": 900})
    page = ctx.new_page()
    page.goto(f"{base}/index.html")
    ready(page)
    portrait = visible(page, "#rotateHint")
    shot(page, "portrait")
    page.set_viewport_size({"width": 1200, "height": 750})
    page.wait_for_timeout(200)
    landscape = visible(page, "#rotateHint")
    check("portraitWarning", portrait and not landscape, f"portrait={portrait} landscape={landscape}")
    ctx.close()


SMALL_JS = """() => [...document.querySelectorAll('button')].filter(b => {
  const r = b.getBoundingClientRect(); const s = getComputedStyle(b);
  return r.width > 0 && r.height > 0 && s.visibility !== 'hidden';
}).map(b => { const r = b.getBoundingClientRect();
  return { id: b.id || b.dataset.tool || b.dataset.kind || b.textContent.trim(), w: r.width, h: r.height }; })
  .filter(x => x.w < 44 || x.h < 44)"""


def buttons_min_48px(browser, base):
    ctx = browser.new_context(viewport={"width": 1024, "height": 768})
    page = ctx.new_page()
    page.goto(f"{base}/index.html?e2e")
    ready(page)
    small = []
    for scr in ("title", "tutorial", "game", "win"):
        if scr == "win":
            page.evaluate("""() => window.__ckUi.showWin({gained:268, base:100, speed:34, streak:4, mult:2,
                usedEasy:false, islandBefore:1, islandAfter:2, nextHint:'다음: 조각 4개 · 위·앞·옆 단서'})""")
        elif scr == "game":
            page.evaluate("() => window.__ckUi.showPuzzle('s4-001', 4)")
            page.evaluate("() => { window.__ckUi.showScreen('game'); window.__ckUi.setEasyAvailable(true); }")
        else:
            page.evaluate(f"() => window.__ckUi.showScreen('{scr}')")
        page.wait_for_timeout(150)
        for s in page.evaluate(SMALL_JS):
            small.append((scr, s))
    check("buttons_min_48px", not small, f"small={small[:5]}")
    ctx.close()


def win_shot(browser, base):
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.goto(f"{base}/index.html?e2e")
    ready(page)
    page.evaluate("""() => window.__ckUi.showWin({gained:268, base:100, speed:34, streak:4, mult:2,
        usedEasy:false, islandBefore:1, islandAfter:2, nextHint:'다음: 조각 4개 · 위·앞·옆 단서'})""")
    page.wait_for_timeout(700)
    shot(page, "win")
    conf_on = page.evaluate("() => document.querySelectorAll('#conf .conf').length")
    ctx.close()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    page = ctx.new_page()
    page.goto(f"{base}/index.html?e2e")
    ready(page)
    page.evaluate("""() => window.__ckUi.showWin({gained:50, base:100, speed:0, streak:1, mult:1,
        usedEasy:true, islandBefore:2, islandAfter:2, nextHint:'다음: 조각 4개 · 위·앞·옆 단서'})""")
    page.wait_for_timeout(300)
    shot(page, "win-reduced")
    conf_off = page.evaluate("() => document.querySelectorAll('#conf .conf').length")
    anim = page.evaluate("() => getComputedStyle(document.querySelector('.rays')).animationName")
    check("win_reduced_motion", conf_on > 0 and conf_off == 0 and anim == "none",
          f"conf_on={conf_on} conf_off={conf_off} rays_anim={anim}")
    ctx.close()


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else None
    server = None
    if base is None:
        server = start_server()
        base = "http://localhost:8766"
    errors = []
    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(channel="msedge")
            try:
                for fn in (title_to_tutorial_first_visit, tutorial_input_kind, clue_card_no_overflow,
                           portrait_warning, buttons_min_48px, win_shot):
                    try:
                        fn(browser, base)
                    except Exception as e:  # 한 시험이 죽어도 나머지는 돈다
                        check(fn.__name__, False, f"error: {str(e).splitlines()[0][:200]}")
                        errors.append(e)
            finally:
                browser.close()
    finally:
        if server:
            server.terminate()
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)} passed, {len(failed)} failed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
