"""문제 은행 감사(2026-10-22) F: 실제 UI 로 문제를 끝까지 푼다. Playwright + 시스템 Edge.

  python tests/e2e/audit_e2e.py [base_url]

base_url 을 주지 않으면 저장소 루트에서 http.server(8769)를 띄우고 끝나면 닫는다.
문제마다 해답 탐색기(src/core/solver.js)의 해답과 가능한 낙하 순서를 페이지 안에서 구하고,
조각마다 (1) 조각을 클릭해 돌리기 링을 열고 링 버튼으로 정답 방향까지 돌린 뒤 (2) 마우스로 끌어
정답 칸에 놓는다. 끌기 목표 화면 좌표는 input.js 와 같은 계산(바닥 y=0 점 + 잡은 곳 offset)으로 구한다.
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

# 잡은 점 g 에서 조각 i 를 (tx, tz) 로 옮기는 놓을 점(화면). input.js dragTo 와 같은 계산.
TARGET_JS = """
([i, gx, gy, tx, tz]) => {
  const c = document.getElementById('c').getBoundingClientRect();
  const ndc = { x: ((gx - c.left) / c.width) * 2 - 1, y: -((gy - c.top) / c.height) * 2 + 1 };
  const f = __ck.world.floorPoint(ndc);
  const p = __ck.pieces()[i];
  return __ck.project(f.x + (tx - p.pos[0]), 0, f.z + (tz - p.pos[2]));
}
"""

results = []
HIDE_RING = "--hide-ring" in sys.argv
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


def pick_point(page, i):
    r = page.evaluate(CANDIDATES_JS, i)
    return (r["ok"][0] if r["ok"] else None), len(r["ok"]), r["tried"]


def solve_by_ui(page, pid, stage):
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
            page.mouse.click(pt["x"], pt["y"])
            mid = page.evaluate(f"__ck.pieces()[{i}].cells")
            if mid != before:
                STATS["piece_click_rotated"] = STATS.get("piece_click_rotated", 0) + 1
            page.wait_for_timeout(120)
            ring = page.evaluate("__ck.input.ringState()")
            if not ring["visible"] or ring["index"] != i:
                return False, f"piece {i}: ring not opened for it ({ring})"
            page.click(f"#ring button[data-axis='{axis}']")
            page.wait_for_timeout(SETTLE_MS)
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
        tgt = page.evaluate(TARGET_JS, [i, pt["x"], pt["y"], goal["pos"][0], goal["pos"][2]])
        page.mouse.move(pt["x"], pt["y"])
        page.mouse.down()
        page.mouse.move(tgt["x"], tgt["y"], steps=14)
        page.mouse.up()
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
            ctx = browser.new_context(viewport=VIEW)
            page = ctx.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{base}/index.html?e2e")
            page.evaluate("() => { localStorage.clear(); localStorage.setItem('ck.tutorialSeen', 'true'); }")
            page.reload()
            page.wait_for_function("() => window.__ckReady === true && window.__ck", timeout=15000)
            page.evaluate("document.fonts.ready")
            page.click("#startBtn")
            page.wait_for_function("() => __ck.state().screen === 'game' && __ck.state().puzzleId", timeout=15000)
            for pid in IDS:
                stage = int(pid[1])
                try:
                    ok, detail = solve_by_ui(page, pid, stage)
                except Exception as e:  # noqa: BLE001 - 한 문제가 죽어도 나머지는 돈다
                    ok, detail = False, f"exception {e}"
                if pid in SHOTS:
                    page.screenshot(path=os.path.join(OUT, f"audit-{pid}.png"))
                check(f"ui_solve {pid}", ok, detail)
            check("no page errors", not errors, "; ".join(errors[:3]))
            # 링이 열린 채로 조각을 누르거나 끌 때 그 점이 링 버튼에 가리면 안 된다(링 버튼이 조각을 덮음)
            check("piece clicks not intercepted by ring", not STATS or HIDE_RING, json.dumps(STATS))
            ctx.close()
            browser.close()
    finally:
        if server:
            server.terminate()
    print("stats:", json.dumps(STATS), "hide_ring:", HIDE_RING)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
