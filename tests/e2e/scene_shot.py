"""Task 6 장면 확인 화면 찍기(Playwright + 시스템 Edge).

저장소 루트에서 `python -m http.server 8765` 를 띄운 뒤 실행한다.
  python tests/e2e/scene_shot.py [base_url]
결과: tests/e2e/out/scene.png, scene-ring.png, scene-proto-ring.png, scene-1366.png, scene-1024.png
"""
import json
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"
OUT = Path(__file__).resolve().parent / "out"
OUT.mkdir(exist_ok=True)

SHOTS = [
    ("scene.png", "?noPerf", (1120, 700)),
    ("scene-ring.png", "?noPerf&debugRing", (1120, 700)),
    ("scene-proto.png", "?noPerf&puzzle=proto", (1120, 700)),
    ("scene-proto-ring.png", "?noPerf&puzzle=proto&debugRing", (1120, 700)),
    ("scene-1366-ring.png", "?noPerf&debugRing", (1366, 768)),
    ("scene-1024-ring.png", "?noPerf&debugRing", (1024, 768)),
    ("scene-spin.png", "?noPerf&puzzle=proto&spin=0.7", (1120, 700)),
    ("scene-4p.png", "?noPerf&puzzle=s3-001", (1120, 700)),
    ("scene-5p.png", "?noPerf&puzzle=s4-006", (1120, 700)),
    ("scene-5p-014.png", "?noPerf&puzzle=s4-014", (1120, 700)),
]


def main():
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        for name, query, (w, h) in SHOTS:
            page = browser.new_page(viewport={"width": w, "height": h})
            page.on("pageerror", lambda e: errors.append(f"{name}: {e}"))
            page.on("console", lambda m: m.type == "error" and errors.append(f"{name}: {m.text}"))
            page.goto(f"{BASE}/tests/e2e/scene.html{query}")
            page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
            if "spin=" in query:
                page.evaluate("window.__ck.setSpin(0.7)")
            page.wait_for_timeout(1200)  # 조각이 자리에 내려앉을 때까지
            info = page.evaluate(
                "({webgl: __ck.webgl, id: __ck.puzzleId, pieces: __ck.pieces(),"
                " xy: __ck.pieces().map((_, i) => __ck.pieceScreenXY(i)),"
                " fits: __ck.pieces().map((_, i) => __ck.fits(i)), spin: __ck.spin()})"
            )
            page.screenshot(path=str(OUT / name))
            print(name, json.dumps(info, ensure_ascii=False))
            page.close()
        # 고르기·바닥 좌표 확인(회전판을 돌린 상태에서도)
        page = browser.new_page(viewport={"width": 1120, "height": 700})
        page.goto(f"{BASE}/tests/e2e/scene.html?noPerf&puzzle=proto")
        page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
        page.wait_for_timeout(800)
        picks = page.evaluate("""() => { const out = []; for (const spin of [0, 0.7]) { __ck.setSpin(spin);
            const r = document.getElementById('c').getBoundingClientRect();
            const ndc = (q) => ({ x: (q.x - r.left) / r.width * 2 - 1, y: -((q.y - r.top) / r.height) * 2 + 1 });
            const picked = __ck.pieces().map((_, i) => __ck.world.pickPiece(ndc(__ck.pieceScreenXY(i))));
            const empty = __ck.world.pickPiece({ x: 0, y: -0.9 });
            const c = __ck.world.center(); const o = __ck.world.toWorld(c.x, 0, c.z);
            const fpz = __ck.world.floorPoint({ x: 0, y: 0 });
            out.push({ spin, picked, empty, originWorld: [o.x, o.z], centerScreenFloor: fpz }); } return out; }""")
        print("picks:", json.dumps(picks))
        for r in picks:
            if r["picked"] != list(range(len(r["picked"]))) or r["empty"] != -1:
                errors.append(f"pickPiece mismatch {r}")
        page.close()
        # 튀기기 중간 화면(바닥 가운데를 축으로 눌리는지 눈으로 확인)
        page = browser.new_page(viewport={"width": 1120, "height": 700})
        page.goto(f"{BASE}/tests/e2e/scene.html?noPerf&puzzle=proto")
        page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
        page.wait_for_timeout(600)
        page.evaluate("__ck.world.bounce(1)")
        page.wait_for_timeout(90)
        page.screenshot(path=str(OUT / "scene-bounce.png"))
        page.close()
        # 저사양 모드(그림자 끔) 화면, WebGL 실패 시 null
        page = browser.new_page(viewport={"width": 1120, "height": 700})
        page.on("pageerror", lambda e: errors.append(f"low: {e}"))
        page.goto(f"{BASE}/tests/e2e/scene.html?noPerf&puzzle=proto")
        page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
        page.evaluate("__ck.world.setShadows(false)")
        page.wait_for_timeout(600)
        page.screenshot(path=str(OUT / "scene-low.png"))
        nullr = page.evaluate("""async () => { const { createRenderer } = await import('/src/scene/perf.js');
            const cv = document.createElement('canvas'); cv.getContext('2d'); return createRenderer(cv) === null; }""")
        print("createRenderer null on 2d canvas:", nullr)
        if not nullr:
            errors.append("createRenderer did not return null")
        page.close()
        # 저사양 감시가 돌아도 오류가 없는지(결과는 기기 성능에 따라 다름)
        page = browser.new_page(viewport={"width": 1120, "height": 700})
        page.on("pageerror", lambda e: errors.append(f"perf: {e}"))
        page.goto(f"{BASE}/tests/e2e/scene.html")
        page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
        page.wait_for_timeout(4000)
        print("lowMode after 4s:", page.evaluate("window.__ck.lowMode"))
        page.close()
        browser.close()
    if errors:
        print("ERRORS:\n" + "\n".join(errors))
        sys.exit(1)
    print("OK")


if __name__ == "__main__":
    main()
