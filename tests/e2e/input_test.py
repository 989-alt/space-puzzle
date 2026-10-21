"""Task 7 입력(끌기·탭·길게 누르기·회전판·링 버튼) e2e. Playwright + 시스템 Edge.

저장소 루트에서 `python -m http.server 8765` 를 띄운 뒤 실행한다.
  python tests/e2e/input_test.py [base_url]

같은 시험을 마우스(page.mouse)와 터치 두 방식으로 돌린다.
터치 방식: browser.new_context(has_touch=True) 에서
  - 탭은 page.touchscreen.tap
  - 끌기·두 손가락·취소는 CDP Input.dispatchTouchEvent(touchStart/touchMove/touchEnd/touchCancel)
  Edge 에서 이 방식은 pointerType 'touch' 포인터 이벤트를 만든다(시험마다 pointerType 을 기록해 확인한다).
마우스 방식의 pointercancel 은 실제 장치로 만들 수 없어 캔버스에 PointerEvent('pointercancel') 를 보낸다.
"""
import sys

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765"
URL = f"{BASE}/tests/e2e/scene.html?noPerf&puzzle=proto"
VIEW = {"width": 1120, "height": 700}


class Pointer:
    """마우스·터치 공통 조작."""

    def __init__(self, page, mode, cdp=None):
        self.page, self.mode, self.cdp = page, mode, cdp

    def _touch(self, kind, pts):
        self.cdp.send("Input.dispatchTouchEvent", {
            "type": kind,
            "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)],
        })

    def down(self, x, y):
        if self.mode == "mouse":
            self.page.mouse.move(x, y)
            self.page.mouse.down()
        else:
            self._touch("touchStart", [(x, y)])

    def move(self, x, y, steps=10, frm=None):
        if self.mode == "mouse":
            self.page.mouse.move(x, y, steps=steps)
        else:
            fx, fy = frm
            for k in range(1, steps + 1):
                self._touch("touchMove", [(fx + (x - fx) * k / steps, fy + (y - fy) * k / steps)])
                self.page.wait_for_timeout(16)

    def up(self):
        if self.mode == "mouse":
            self.page.mouse.up()
        else:
            self._touch("touchEnd", [])

    def cancel(self):
        if self.mode == "mouse":
            self.page.evaluate("""() => { const c = document.getElementById('c');
                c.dispatchEvent(new PointerEvent('pointercancel', { pointerId: __lastPointerId,
                  pointerType: 'mouse', bubbles: true })); }""")
        else:
            self._touch("touchCancel", [])

    def tap(self, x, y):
        if self.mode == "mouse":
            self.page.mouse.click(x, y)
        else:
            self.page.touchscreen.tap(x, y)

    def drag(self, a, b, steps=12):
        self.down(*a)
        self.page.wait_for_timeout(30)
        self.move(b[0], b[1], steps=steps, frm=a)
        self.page.wait_for_timeout(30)
        self.up()


def open_page(ctx, mode):
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("window.__ck && window.__ck.ready", timeout=20000)
    page.wait_for_function("window.__ck.input", timeout=5000)
    page.evaluate("""() => { window.__types = []; window.__lastPointerId = 1;
        document.getElementById('c').addEventListener('pointerdown', (e) => {
          if (!e.isTrusted) return; // 시험이 넣은 가짜(유령) 포인터는 세지 않는다
          window.__types.push(e.pointerType); window.__lastPointerId = e.pointerId; }, true); }""")
    page.wait_for_timeout(600)
    cdp = ctx.new_cdp_session(page) if mode == "touch" else None
    return page, Pointer(page, mode, cdp), errors


def xy(page, i):
    r = page.evaluate(f"__ck.pieceScreenXY({i})")
    return (r["x"], r["y"])


def pieces(page):
    return page.evaluate("__ck.pieces()")


def empty_spot(page):
    """조각도 판도 없는 바닥 점(작업대 아래쪽 가장자리 근처)."""
    for fx, fy in [(0.5, 0.86), (0.3, 0.8), (0.7, 0.8), (0.5, 0.18), (0.15, 0.5)]:
        x, y = VIEW["width"] * fx, VIEW["height"] * fy
        hit = page.evaluate(f"""() => {{ const r = document.getElementById('c').getBoundingClientRect();
            return __ck.world.pickPiece({{ x: ({x} - r.left) / r.width * 2 - 1, y: -(({y} - r.top) / r.height) * 2 + 1 }}); }}""")
        if hit == -1:
            return (x, y)
    raise AssertionError("no empty spot")


def ring_visible(page):
    return page.evaluate("__ck.lastRing().visible")


def target_y(page, i):
    return page.evaluate(f"__ck.pieceTargetY({i})")


def is_int(v):
    return abs(v - round(v)) < 1e-9


# ---- 시험 ----

def drag_moves_piece(page, ptr):
    before = pieces(page)[0]["pos"]
    a = xy(page, 0)
    ptr.drag(a, (a[0] + 120, a[1]))
    page.wait_for_timeout(300)
    after = pieces(page)[0]["pos"]
    assert after != before, f"pos unchanged {before}"
    assert is_int(target_y(page, 0)), f"lifted after drop {target_y(page, 0)}"
    assert not ring_visible(page), "ring shown after drag"
    assert page.evaluate("__ck.drops") >= 1, "onDrop not called"


def drag_far_stays_inside(page, ptr):
    a = xy(page, 0)
    ptr.drag(a, (5, 5), steps=20)
    page.wait_for_timeout(300)
    assert page.evaluate("__ck.fits(0)"), f"outside {pieces(page)[0]}"
    a = xy(page, 2)
    ptr.drag(a, (VIEW["width"] - 5, VIEW["height"] - 5), steps=20)
    page.wait_for_timeout(300)
    assert page.evaluate("__ck.fits(2)"), f"outside {pieces(page)[2]}"


def tap_opens_ring(page, ptr):
    before = pieces(page)[1]
    spin0 = page.evaluate("__ck.spin()")
    ptr.tap(*xy(page, 1))
    page.wait_for_timeout(150)
    ring = page.evaluate("__ck.lastRing()")
    assert ring["visible"] and ring["index"] == 1, f"ring {ring}"
    # #ring 자체는 크기 0 인 기준점이라 안쪽 버튼으로 보이는지 본다
    assert page.is_visible('#ring button[data-axis="y"]'), "#ring not visible"
    # 링 버튼은 화면 안에 다 들어오고 48px 이상
    for b in page.query_selector_all("#ring button"):
        bb = b.bounding_box()
        assert bb["width"] >= 48 and bb["height"] >= 48, f"small button {bb}"
        assert bb["x"] >= 0 and bb["y"] >= 0 and bb["x"] + bb["width"] <= VIEW["width"] \
            and bb["y"] + bb["height"] <= VIEW["height"], f"clipped {bb}"
    btn = page.query_selector('#ring button[data-axis="y"]').bounding_box()
    ptr.tap(btn["x"] + btn["width"] / 2, btn["y"] + btn["height"] / 2)
    page.wait_for_timeout(200)
    after = pieces(page)[1]
    assert after["cells"] != before["cells"], "cells unchanged after 돌리기"
    assert page.evaluate("__ck.rotations") == [[1, "y"]], page.evaluate("__ck.rotations")
    assert page.evaluate("__ck.spin()") == spin0, "ring click spun the board"
    assert is_int(target_y(page, 1)), "rotated piece lifted"


def ring_near_edge_not_clipped(page, ptr):
    # 조각을 화면 모서리 쪽으로 옮긴 뒤 탭 → 링 버튼·글자가 화면 밖으로 나가지 않는다
    a = xy(page, 0)
    ptr.drag(a, (5, VIEW["height"] - 5), steps=20)
    page.wait_for_timeout(400)
    ptr.tap(*xy(page, 0))
    page.wait_for_timeout(150)
    assert ring_visible(page)
    for el in page.query_selector_all("#ring button, #ring small"):
        bb = el.bounding_box()
        assert bb["x"] >= 0 and bb["y"] >= 0 and bb["x"] + bb["width"] <= VIEW["width"] \
            and bb["y"] + bb["height"] <= VIEW["height"], f"clipped {bb}"


def long_press_opens_ring(page, ptr):
    a = xy(page, 2)
    ptr.down(*a)
    page.wait_for_timeout(650)
    shown = ring_visible(page)
    ptr.up()
    page.wait_for_timeout(100)
    assert shown, "ring not shown by long press"
    assert ring_visible(page) and page.evaluate("__ck.lastRing().index") == 2


def empty_tap_hides_ring(page, ptr):
    ptr.tap(*xy(page, 1))
    page.wait_for_timeout(100)
    assert ring_visible(page)
    ptr.tap(*empty_spot(page))
    page.wait_for_timeout(100)
    assert not ring_visible(page), "ring still visible after empty tap"
    assert page.evaluate("__ck.selected") is None


def empty_drag_spins(page, ptr):
    before = [p["pos"] for p in pieces(page)]
    ptr.tap(*xy(page, 1))
    page.wait_for_timeout(100)
    a = empty_spot(page)
    ptr.drag(a, (a[0] + 200, a[1]), steps=20)
    page.wait_for_timeout(100)
    spin = page.evaluate("__ck.spin()")
    assert abs(spin) > 0.5, f"spin {spin}"
    assert abs(spin - 200 * 0.008) < 0.2, f"spin {spin} != {200 * 0.008}"
    assert [p["pos"] for p in pieces(page)] == before, "spin moved pieces"
    assert not ring_visible(page), "ring visible during spin"
    page.evaluate("__ck.input.resetSpin()")
    assert page.evaluate("__ck.spin()") == 0


def cancel_mid_drag_lands(page, ptr):
    a = xy(page, 0)
    ptr.down(*a)
    page.wait_for_timeout(30)
    ptr.move(a[0] + 90, a[1] + 10, steps=10, frm=a)
    page.wait_for_timeout(50)
    lifted = target_y(page, 0)
    assert not is_int(lifted), f"not lifted during drag {lifted}"
    drops = page.evaluate("__ck.drops")
    ptr.cancel()
    page.wait_for_timeout(100)
    ty = target_y(page, 0)
    assert is_int(ty), f"target.y {ty} still lifted after pointercancel"
    assert ty == pieces(page)[0]["pos"][1]
    assert page.evaluate("__ck.drops") == drops + 1, "onDrop not called on cancel"
    if ptr.mode == "mouse":
        ptr.up()  # 실제 버튼도 놓는다
    page.wait_for_timeout(100)
    assert is_int(target_y(page, 0))
    assert not ring_visible(page)


def second_finger_lands_then_spins(page, ptr):
    """터치 전용: 끌던 중 두 번째 손가락 → 내려놓기, 두 손가락 평균 x 로 회전."""
    a = xy(page, 0)
    ptr._touch("touchStart", [a])
    for k in range(1, 9):
        ptr._touch("touchMove", [(a[0] + k * 10, a[1])])
        page.wait_for_timeout(16)
    assert not is_int(target_y(page, 0))
    pos_mid = pieces(page)[0]["pos"]
    b0 = empty_spot(page)
    p0 = (a[0] + 80, a[1])
    ptr._touch("touchStart", [p0, b0])
    page.wait_for_timeout(50)
    assert is_int(target_y(page, 0)), "second finger did not land the piece"
    spin0 = page.evaluate("__ck.spin()")
    for k in range(1, 11):
        ptr._touch("touchMove", [(p0[0] + k * 10, p0[1]), (b0[0] + k * 10, b0[1])])
        page.wait_for_timeout(16)
    ptr._touch("touchEnd", [])
    page.wait_for_timeout(100)
    spin = page.evaluate("__ck.spin()")
    assert abs((spin - spin0) - 100 * 0.008) < 0.1, f"two-finger spin {spin - spin0}"
    assert pieces(page)[0]["pos"] == pos_mid, "piece moved while spinning"


def right_button_ignored(page, ptr):
    """마우스 전용: 오른쪽 버튼은 끌기·회전을 하지 않는다."""
    before = pieces(page)[0]["pos"]
    a = xy(page, 0)
    page.mouse.move(*a)
    page.mouse.down(button="right")
    page.mouse.move(a[0] + 150, a[1], steps=10)
    page.mouse.up(button="right")
    page.wait_for_timeout(100)
    assert pieces(page)[0]["pos"] == before and page.evaluate("__ck.spin()") == 0


def ghost_down(page, x, y, pid, ptype):
    """떼기 없이 남는 유령 pointerdown(놓친 pointerup 흉내)."""
    page.evaluate(f"""() => document.getElementById('c').dispatchEvent(new PointerEvent('pointerdown',
        {{ pointerId: {pid}, pointerType: '{ptype}', clientX: {x}, clientY: {y}, button: 0, buttons: 1,
           isPrimary: true, bubbles: true }}))""")


def ghost_pointer_then_drag_moves(page, ptr):
    """유령 포인터가 남아 있어도 새 끌기는 조각을 옮긴다(두 손가락 회전으로 빠지지 않는다).
    마우스: 새 마우스 pointerdown 이 남은 포인터를 비운다. 터치: 2초 넘게 움직임 없는 포인터는 버린다."""
    e = empty_spot(page)
    if ptr.mode == "mouse":
        ghost_down(page, e[0], e[1], 7, "touch")
    else:
        ghost_down(page, e[0], e[1], 77, "touch")
        page.wait_for_timeout(2200)
    before = pieces(page)[0]["pos"]
    a = xy(page, 0)
    ptr.drag(a, (a[0] + 120, a[1]))
    page.wait_for_timeout(300)
    assert page.evaluate("__ck.spin()") == 0, f"spun {page.evaluate('__ck.spin()')}"
    assert pieces(page)[0]["pos"] != before, "piece did not move"
    assert is_int(target_y(page, 0))


def ghost_mouse_hover_does_not_spin(page, ptr):
    """마우스 전용: 놓친 떼기로 남은 마우스 포인터는 버튼 없는 이동(buttons 0)에서 버린다."""
    e = empty_spot(page)
    ghost_down(page, e[0], e[1], 1, "mouse")
    page.mouse.move(e[0], e[1])
    page.mouse.move(e[0] + 150, e[1], steps=10)
    page.wait_for_timeout(100)
    assert page.evaluate("__ck.spin()") == 0, f"hover spun {page.evaluate('__ck.spin()')}"
    a = xy(page, 0)
    before = pieces(page)[0]["pos"]
    ptr.drag(a, (a[0] + 120, a[1]))
    page.wait_for_timeout(300)
    assert pieces(page)[0]["pos"] != before and page.evaluate("__ck.spin()") == 0


TESTS = [drag_moves_piece, drag_far_stays_inside, tap_opens_ring, ring_near_edge_not_clipped,
         long_press_opens_ring, empty_tap_hides_ring, empty_drag_spins, cancel_mid_drag_lands,
         ghost_pointer_then_drag_moves]
TOUCH_ONLY = [second_finger_lands_then_spins]
MOUSE_ONLY = [right_button_ignored, ghost_mouse_hover_does_not_spin]


def main():
    failed, passed = [], 0
    with sync_playwright() as p:
        browser = p.chromium.launch(channel="msedge")
        try:
            for mode in ("mouse", "touch"):
                for t in TESTS + (TOUCH_ONLY if mode == "touch" else MOUSE_ONLY):
                    name = f"[{mode}] {t.__name__}"
                    ctx = browser.new_context(viewport=VIEW, has_touch=(mode == "touch"))
                    try:
                        page, ptr, errors = open_page(ctx, mode)
                        t(page, ptr)
                        types = set(page.evaluate("window.__types"))
                        assert types and types <= {mode}, f"pointerType {types}"
                        assert not errors, f"page errors {errors}"
                        passed += 1
                        print("PASS", name)
                    except Exception as e:  # noqa: BLE001
                        failed.append(name)
                        print("FAIL", name, "-", str(e).splitlines()[0][:300])
                    finally:
                        ctx.close()
        finally:
            browser.close()
    print(f"{passed} passed, {len(failed)} failed")
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
