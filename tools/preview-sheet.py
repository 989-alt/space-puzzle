"""문제 은행 미리보기 한 장 그림(contact sheet).

python tools/preview-sheet.py  ->  design/review/puzzles-s1..4.png

카드마다 목표 모양(등각 투영, 하늘색)과 조각 목록(조각 색, 은행에 저장된 대표 방향)을 그린다.
사람이 눈으로 단조롭거나 이상한 문제를 거르는 용도다.
"""
from pathlib import Path
import json
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "design" / "review"

PIECE_COLORS = ["#3B9BFF", "#3DD47A", "#FF8A2B", "#A86BFF", "#FFD23F"]
TARGET_COLOR = "#8FEFFF"
INK = "#2A1A5E"
CARD_BG = "#FFF8E8"
SHEET_BG = "#E9E3F7"

COLS = 5
CARD_W, CARD_H = 380, 300
GAP = 12


def load_font(size):
    for name in ("malgun.ttf", "arial.ttf"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


FONT = load_font(16)
FONT_SMALL = load_font(13)


def hex_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def shade(rgb, f):
    return tuple(max(0, min(255, round(c * f))) for c in rgb)


def project(x, y, z, s):
    """+x·+y·+z 쪽(앞·오른쪽·위)에서 본 등각 투영. 화면 v는 아래로 커진다."""
    c = math.cos(math.radians(30))
    return ((x - z) * c * s, (x + z) * 0.5 * s - y * s)


def cube_faces(x, y, z):
    top = [(x, y + 1, z), (x + 1, y + 1, z), (x + 1, y + 1, z + 1), (x, y + 1, z + 1)]
    front = [(x, y, z + 1), (x + 1, y, z + 1), (x + 1, y + 1, z + 1), (x, y + 1, z + 1)]
    right = [(x + 1, y, z), (x + 1, y, z + 1), (x + 1, y + 1, z + 1), (x + 1, y + 1, z)]
    return [(top, 1.0), (front, 0.82), (right, 0.66)]


def bounds(cells, s):
    pts = [project(*p, s) for (x, y, z) in cells for face, _ in cube_faces(x, y, z) for p in face]
    us = [p[0] for p in pts]
    vs = [p[1] for p in pts]
    return min(us), min(vs), max(us), max(vs)


def draw_cells(draw, cells, color, s, ox, oy):
    """(ox, oy)를 투영 상자의 왼쪽 위로 삼아 칸들을 그린다. 먼 칸부터 칠한다."""
    u0, v0, _, _ = bounds(cells, s)
    rgb = hex_rgb(color)
    edge = shade(rgb, 0.45)
    for (x, y, z) in sorted(cells, key=lambda c: (c[0] + c[1] + c[2], c[1])):
        for face, f in cube_faces(x, y, z):
            poly = [(ox + u - u0, oy + v - v0) for (u, v) in (project(*p, s) for p in face)]
            draw.polygon(poly, fill=shade(rgb, f), outline=edge)


def size_of(cells, s):
    u0, v0, u1, v1 = bounds(cells, s)
    return u1 - u0, v1 - v0


def heights_text(target):
    w = max(c[0] for c in target) + 1
    d = max(c[2] for c in target) + 1
    grid = [[0] * w for _ in range(d)]
    for x, y, z in target:
        grid[z][x] = max(grid[z][x], y + 1)
    return "/".join("".join(str(h) if h else "." for h in row) for row in grid)


def draw_card(img, puzzle, x0, y0):
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle([x0, y0, x0 + CARD_W, y0 + CARD_H], radius=12, fill=CARD_BG, outline="#C9BEE8")
    target = puzzle["target"]
    head = f'{puzzle["id"]}  칸 {len(target)}  조각 {len(puzzle["pieces"])}  해답 {puzzle["solutions"]}'
    draw.text((x0 + 10, y0 + 8), head, fill=INK, font=FONT)
    draw.text((x0 + 10, y0 + 30), "높이 " + heights_text(target), fill=INK, font=FONT_SMALL)

    # 목표: 카드 위쪽 영역(높이 150)에 맞춰 크기를 정한다.
    area_w, area_h = CARD_W - 20, 150
    s = 28
    while s > 8:
        w, h = size_of(target, s)
        if w <= area_w and h <= area_h:
            break
        s -= 1
    w, h = size_of(target, s)
    draw_cells(draw, target, TARGET_COLOR, s, x0 + (CARD_W - w) / 2, y0 + 52 + (area_h - h) / 2)

    # 조각 목록: 아래쪽 한 줄.
    pieces = puzzle["pieces"]
    slot_w = (CARD_W - 20) / len(pieces)
    py = y0 + 52 + area_h + 10
    for i, pc in enumerate(pieces):
        ps = 16
        while ps > 6:
            w, h = size_of(pc, ps)
            if w <= slot_w - 8 and h <= CARD_H - (py - y0) - 10:
                break
            ps -= 1
        w, h = size_of(pc, ps)
        sx = x0 + 10 + i * slot_w + (slot_w - w) / 2
        draw_cells(draw, pc, PIECE_COLORS[i % len(PIECE_COLORS)], ps, sx, py)


def sheet(stage):
    puzzles = json.loads((DATA / f"puzzles-s{stage}.json").read_text(encoding="utf-8"))
    rows = math.ceil(len(puzzles) / COLS)
    title_h = 50
    img = Image.new("RGB", (COLS * (CARD_W + GAP) + GAP, title_h + rows * (CARD_H + GAP) + GAP), SHEET_BG)
    ImageDraw.Draw(img).text((GAP, 14), f"단계 {stage} 문제 은행 ({len(puzzles)}문제)", fill=INK, font=load_font(22))
    for i, p in enumerate(puzzles):
        r, c = divmod(i, COLS)
        draw_card(img, p, GAP + c * (CARD_W + GAP), title_h + r * (CARD_H + GAP))
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"puzzles-s{stage}.png"
    img.save(path, optimize=True)
    print(f"wrote {path.relative_to(ROOT)} ({img.width}x{img.height})")


if __name__ == "__main__":
    for st in (1, 2, 3, 4):
        sheet(st)
