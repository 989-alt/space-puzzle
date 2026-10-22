"""문제 은행 감사(2026-10-22) F: 실제 UI 로 문제를 끝까지 푼다. Playwright + 시스템 Edge.

  python tests/e2e/audit_e2e.py [base_url] [--touch] [--ids=s1-001,s2-010,...] [--hide-ring]

--touch: 터치(CDP touchStart/Move/End, 탭은 touchscreen.tap)로 조작한다. 기본은 마우스.
--ids: 풀 문제 목록(기본 IDS 12문제). --hide-ring: 조각을 누르기 전에 링을 닫는다(원인 확인용).

base_url 을 주지 않으면 저장소 루트에서 http.server(8769)를 띄우고 끝나면 닫는다.
문제마다 해답 탐색기(src/core/solver.js)의 해답과 가능한 낙하 순서를 페이지 안에서 구하고,
조각마다 (1) 조각을 클릭해 돌리기 링을 열고 링 버튼으로 정답 방향까지 돌린 뒤 (2) 링을 연 채로 조각을 끌어
정답 칸에 놓는다. 끌기 목표 화면 좌표는 잡은 점(world.pickHit)이 정답 자리에서 올 화면 점이다.
마지막에 정답 화면(#screen-win)이 뜨는지 본다. 캡처는 tests/e2e/out/audit-*.png.
조각이 다른 조각에 가려 클릭으로 고를 수 없으면 그 조각의 다른 칸을 차례로 눌러 보고, 고른 칸 수를 기록한다.
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
PORT = 8769
VIEW = {"width": 1280, "height": 800}
IDS = ["s1-001", "s1-002", "s1-020", "s2-006", "s2-015", "s2-036",
       "s3-001", "s3-017", "s3-033", "s4-005", "s4-022", "s4-040"]
SHOTS = {"s2-036", "s4-022"}
SETTLE_MS = 450

PLAN_JS = """
async (id) => {
  const { solve } = await import('./src/core/solver.js');
  const { dropY, worldCells } = await import('./src/core/board.js');
  const { rotate, normalize, key } = await import('./src/core/pieces.js');
  const p = __ck.puzzle();
  const cur = __ck.pieces();
  const sols = solve(p.target, p.pieces, { limit: 50 }).solutions;
  const perms = (n) => { const out = []; const rec = (a, u) => { if (a.length === n) { out.push(a.slice()); return; }
    for (let i = 0; i < n; i++) if (!u[i]) { u[i] = 1; a.push(i); rec(a, u); a.pop(); u[i] = 0; } }; rec([], []); return out; };
  const valid = (sol) => perms(sol.length).filter((perm) => { const occ = new Set();
    for (const i of perm) { const s = sol[i]; if (dropY(s.cells, s.pos[0], s.pos[2], occ) !== s.pos[1]) return false;
      for (const c of worldCells(s)) occ.add(key(c)); } return true; });
  let sol = null, order = null;
  for (const s of sols) { const v = valid(s); if (v.length) { sol = s; order = v[0]; break; } }
  const sig = (c) => normalize(c).map(key).join(';');
  const path = (from, to) => { const goal = sig(to); const start = normalize(from);
    if (sig(start) === goal) return []; const prev = new Map([[sig(start), null]]); const q = [start];
    while (q.length) { const c = q.shift(); for (const a of ['y', 'x', 'z']) { const n = rotate(c, a); const s = sig(n);
      if (prev.has(s)) continue; prev.set(s, [sig(c), a]);
      if (s === goal) { const out = []; for (let k = s; prev.get(k); k = prev.get(k)[0]) out.unshift(prev.get(k)[1]); return out; }
      q.push(n); } } return null; };
  return { sol, order, paths: sol ? sol.map((s, i) => path(cur[i].cells, s.cells)) : null };
}
"""

# 조각 i 의 칸들 화면 좌표(윗면 가운데) 중 실제로 pickPiece 가 i 를 고르는 점들
CANDIDATES_JS = """
(i) => {
  const p = __ck.pieces()[i];
  const c = document.getElementById('c').getBoundingClientRect();
  const out = [];
  const first = __ck.pieceScreenXY(i);
  const pts = [first];
  for (const q of p.cells) {
    pts.push(__ck.project(p.pos[0] + q[0] + 0.5, p.pos[1] + q[1] + 0.95, p.pos[2] + q[2] + 0.5));
    pts.push(__ck.project(p.pos[0] + q[0] + 0.5, p.pos[1] + q[1] + 0.5, p.pos[2] + q[2] + 1.0));
  }
  for (const s of pts) {
    const ndc = { x: ((s.x - c.left) / c.width) * 2 - 1, y: -((s.y - c.top) / c.height) * 2 + 1 };
    if (__ck.world.pickPiece(ndc) === i) out.push(s);
  }
  return { ok: out, tried: pts.length };
}
"""

# 잡은 점 g 에서 조각 i 를 (tx, ty, tz) 로 옮기는 놓을 점(화면): 잡은 점(조각 위의 점)이 목표 자리에서 올 화면 점.
# input.js 와 같이 world.pickHit 로 잡은 점을 구한다(끌기는 그 점이 손가락 아래에 오는 자리로 간다).
TARGET_JS = """
([i, gx, gy, tx, ty, tz]) => {
  const c = document.getElementById('c').getBoundingClientRect();
  const ndc = { x: ((gx - c.left) / c.width) * 2 - 1, y: -((gy - c.top) / c.height) * 2 + 1 };
  const h = __ck.world.pickHit(ndc);
  const o = [h.point.x - h.at.x, h.point.y - h.at.y, h.point.z - h.at.z];
  return __ck.project(tx + o[0], ty + o[1], tz + o[2]);
}
"""

results = []
HIDE_RING = "--hide-ring" in sys.argv
TOUCH = "--touch" in sys.argv
for _a in sys.argv[1:]:
    if _a.startswith("--ids="):
        IDS = [x for x in _a[len("--ids="):].split(",") if x]
STATS = {}

# 화면 점에서 맨 위 요소: canvas / ring-button / other
HIT_JS = """
([x, y]) => { const el = document.elementFromPoint(x, y); if (!el) return 'none';
  if (el.id === 'c') return 'canvas'; if (el.closest('#ring button')) return 'ring-button';
  return el.id || el.tagName.toLowerCase(); }
"""


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  ({detail})" if detail else ""), flush=True)


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


class Finger:
    """마우스 또는 터치 조작."""

    def __init__(self, page, cdp):
        self.page, self.cdp = page, cdp

    def _touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind, "touchPoints": [{"x": x, "y": y, "id": 0} for (x, y) in pts]})

    def tap(self, x, y):
        if TOUCH:
            self.page.touchscreen.tap(x, y)
        else:
            self.page.mouse.click(x, y)

    def tap_el(self, sel):
        b = self.page.query_selector(sel).bounding_box()
        self.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)

    def drag(self, a, b, steps=14):
        if TOUCH:
            self._touch("touchStart", [a])
            for k in range(1, steps + 1):
                self._touch("touchMove", [(a[0] + (b[0] - a[0]) * k / steps, a[1] + (b[1] - a[1]) * k / steps)])
                self.page.wait_for_timeout(16)
            self._touch("touchEnd", [])
        else:
            self.page.mouse.move(*a)
            self.page.mouse.down()
            self.page.mouse.move(b[0], b[1], steps=steps)
            self.page.mouse.up()


def pick_point(page, i):
    r = page.evaluate(CANDIDATES_JS, i)
    return (r["ok"][0] if r["ok"] else None), len(r["ok"]), r["tried"]


def solve_by_ui(page, fin, pid, stage):
    page.evaluate("() => { __ckUi.showScreen('game'); }")
    page.evaluate(f"() => __ck.setProgress({{ stage: {stage}, streak: 0, promo: 0 }})")
    page.evaluate(f"() => __ck.setPuzzle('{pid}')")
    page.wait_for_timeout(SETTLE_MS)
    plan = page.evaluate(PLAN_JS, pid)
    if not plan["sol"]:
        return False, "no solution with drop order"
    notes = []
    for i in plan["order"]:
        goal = plan["sol"][i]
        # 1) 링으로 돌리기
        for axis in plan["paths"][i]:
            if HIDE_RING:
                page.evaluate("__ck.input.hideRing()")
            pt, n_ok, tried = pick_point(page, i)
            if pt is None:
                return False, f"piece {i}: cannot pick for rotate (0/{tried} points)"
            hit = page.evaluate(HIT_JS, [pt["x"], pt["y"]])
            if hit != "canvas":
                STATS["click_on_" + hit] = STATS.get("click_on_" + hit, 0) + 1
            before = page.evaluate(f"__ck.pieces()[{i}].cells")
            fin.tap(pt["x"], pt["y"])
            mid = page.evaluate(f"__ck.pieces()[{i}].cells")
            if mid != before:
                STATS["piece_click_rotated"] = STATS.get("piece_click_rotated", 0) + 1
            page.wait_for_timeout(120)
            ring = page.evaluate("__ck.input.ringState()")
            if not ring["visible"] or ring["index"] != i:
                return False, f"piece {i}: ring not opened for it ({ring})"
            fin.tap_el(f"#ring button[data-axis='{axis}']")
            page.wait_for_timeout(SETTLE_MS)
            if os.environ.get("AUDIT_DEBUG"):
                print("ROT", pid, i, axis, pt, page.evaluate("__ck.input.ringState()"), page.evaluate(f"__ck.pieces()[{i}]"), flush=True)
                print("BOXES", json.dumps([{**b, "l": round(b["l"] * 1280), "r": round(b["r"] * 1280), "t": round(b["t"] * 800), "b": round(b["b"] * 800)}
                                           for b in page.evaluate("__ck.world.cubeBoxes(__ck.pieces())")]), flush=True)
        if HIDE_RING:
            page.evaluate("__ck.input.hideRing()")
        cells = page.evaluate(f"__ck.pieces()[{i}].cells")
        if json.dumps(sorted(cells)) != json.dumps(sorted(goal["cells"])):
            return False, f"piece {i}: orientation after ring {cells} != {goal['cells']}"
        # 2) 끌어 놓기
        pt, n_ok, tried = pick_point(page, i)
        if pt is None:
            return False, f"piece {i}: cannot pick for drag (0/{tried} points)"
        if n_ok < tried:
            notes.append(f"p{i} pickable {n_ok}/{tried}")
        hit = page.evaluate(HIT_JS, [pt["x"], pt["y"]])
        if hit != "canvas":
            STATS["drag_on_" + hit] = STATS.get("drag_on_" + hit, 0) + 1
            if os.environ.get("AUDIT_DEBUG"):
                print("DEBUG", pid, i, pt, page.evaluate("__ck.input.ringState()"),
                      [b.bounding_box() for b in page.query_selector_all("#ring button")],
                      page.evaluate(f"__ck.pieces()[{i}]"), flush=True)
        tgt = page.evaluate(TARGET_JS, [i, pt["x"], pt["y"], goal["pos"][0], goal["pos"][1], goal["pos"][2]])
        fin.drag((pt["x"], pt["y"]), (tgt["x"], tgt["y"]))
        page.wait_for_timeout(SETTLE_MS)
        got = page.evaluate(f"__ck.pieces()[{i}]")
        if got["pos"] != goal["pos"]:
            return False, f"piece {i}: landed {got['pos']} want {goal['pos']}"
    page.wait_for_timeout(600)
    st = page.evaluate("__ck.state()")
    ok = st["screen"] == "win" and st["solved"]
    return ok, f"screen={st['screen']} level={st['level']} shakes={st['shakes']} {' '.join(notes)}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    base = args[0] if args else None
    server = None
    if not base:
        server = start_server()
        base = f"http://localhost:{PORT}"
    try:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            ctx = browser.new_context(viewport=VIEW, has_touch=TOUCH)
            page = ctx.new_page()
            fin = Finger(page, ctx.new_cdp_session(page) if TOUCH else None)
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?e2e")
            page.evaluate("() => { localStorage.clear(); localStorage.setItem('ck.tutorialSeen', 'true'); }")
            page.reload()
            page.wait_for_function("() => window.__ckReady === true && window.__ck", timeout=15000)
            page.evaluate("document.fonts.ready")
            page.click("#startBtn")
            page.evaluate("""() => { window.__types = new Set();
                document.getElementById('c').addEventListener('pointerdown', (e) => window.__types.add(e.pointerType), true); }""")
            page.wait_for_function("() => __ck.state().screen === 'game' && __ck.state().puzzleId", timeout=15000)
            for pid in IDS:
                stage = int(pid[1])
                try:
                    ok, detail = solve_by_ui(page, fin, pid, stage)
                except Exception as e:  # noqa: BLE001 - 한 문제가 죽어도 나머지는 돈다
                    ok, detail = False, f"exception {e}"
                if pid in SHOTS:
                    page.screenshot(path=os.path.join(OUT, f"audit-{pid}.png"))
                check(f"ui_solve {pid}", ok, detail)
            check("no page errors", not errors, "; ".join(errors[:3]))
            types = page.evaluate("[...window.__types]")
            check("pointer type", types == ["touch" if TOUCH else "mouse"], str(types))
            # 링이 열린 채로 조각을 누르거나 끌 때 그 점이 링 버튼에 가리면 안 된다(링 버튼이 조각을 덮음)
            check("piece clicks not intercepted by ring", not STATS or HIDE_RING, json.dumps(STATS))
            ctx.close()
            browser.close()
    finally:
        if server:
            server.terminate()
    print("stats:", json.dumps(STATS), "hide_ring:", HIDE_RING, "touch:", TOUCH, "puzzles:", len(IDS))
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
