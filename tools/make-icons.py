#!/usr/bin/env python3
"""画出这套图标：一只桶倒进另一只桶（倒水量 · POUR）。

为什么图标是**位图文件**、不是 SVG、也不是内联 base64：
  · 浏览器标签页、桌面安装（PWA）、iOS 主屏要的都是真位图，SVG 在这三处各有各的毛病；
  · 仓里的上线清单闸（`tools/deploy-set.mjs` 的 P 段）把 manifest 声明的 `sizes` 与 PNG 的
    IHDR 真宽高逐张对账——图标必须是真 PNG，"看起来像"的占位过不了这一段。

配色只从本仓 `css/game.css` 的 token 里取，不另编：地面 `#0f1217`/`#171a21`，桶线 `#e6e9ef`，
水 `#60bee8`，高光 `#78dcff`，目标线 `#e0a63c`。画法与中央美术件
（`z-biz-game-lead/007_美术资产` + `polish/script/make_icons.py`）同一套口径：深色径向底 +
图形层 + 一道斜向柔光；maskable 那一档把图形缩进 80% 安全区。

跑法：`python3 tools/make-icons.py`（需要 Pillow；只在重画时用，页面与 CI 都不依赖它）。
"""
import math
import os
import struct

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
OUT = os.path.join(ROOT, 'icons')

# —— 配色：与 css/game.css 的 :root token 一一对应 ——
BG_EDGE = (0x0a, 0x0c, 0x11)
BG_TOP = (0x1c, 0x21, 0x2a)
VESSEL_FILL = (0x15, 0x19, 0x21)
INK = (0xe6, 0xe9, 0xef)
WATER = (0x60, 0xbe, 0xe8)
CYAN = (0x78, 0xdc, 0xff)
AMBER = (0xe0, 0xa6, 0x3c)

S = 2  # 超采样倍数：先画大再缩，边缘才是平滑的而不是锯齿的
MASTER = 1024
STROKE = 22             # 桶壁的粗细（master 空间）

# 画布坐标（MASTER 空间）。倾倒的桶在左上，接水的桶在右下，中间那道水柱是主角。
JUG_W, JUG_H = 270, 330
JUG_TILT = 32.0          # 顺时针倾倒：口沿的右端更低，水往右倒
JUG_X, JUG_Y = 150, 120
JUG_R = 26
JUG_WATER = 190          # 桶里的水面（高于口沿，所以水正在往外走）

RCP_TOP = 330            # 接水桶的上沿
RCP_BOT = 830
RCP_TOP_X = (600, 890)
RCP_BOT_X = (655, 835)
RCP_R = 28
WATER_LEVEL = 600        # 接水桶里的水面
TARGET_LINE = 520        # 目标线（琥珀色）：面板上"目标"那一行就是这个颜色


def sc(pts):
    """master 坐标 → 画布坐标（乘超采样倍数）。"""
    return [(x * S, y * S) for (x, y) in pts]


def rot(pts, deg, pivot):
    """绕 pivot 旋转点集（屏幕坐标 y 向下，正角度=画面上顺时针）。"""
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    px, py = pivot
    return [((x - px) * c - (y - py) * s + px, (x - px) * s + (y - py) * c + py)
            for (x, y) in pts]


def round_poly(pts, r, seg=12):
    """把一个多边形的角磨圆（每段弧用 seg 个采样点）。"""
    out = []
    n = len(pts)
    for i in range(n):
        p = pts[i]
        prev = pts[(i - 1) % n]
        nxt = pts[(i + 1) % n]
        v1 = (prev[0] - p[0], prev[1] - p[1])
        v2 = (nxt[0] - p[0], nxt[1] - p[1])
        l1 = math.hypot(*v1) or 1.0
        l2 = math.hypot(*v2) or 1.0
        rr = min(r, l1 / 2.0, l2 / 2.0)
        a1 = (p[0] + v1[0] * rr / l1, p[1] + v1[1] * rr / l1)
        a2 = (p[0] + v2[0] * rr / l2, p[1] + v2[1] * rr / l2)
        ang1 = math.atan2(a1[1] - p[1], a1[0] - p[0])
        ang2 = math.atan2(a2[1] - p[1], a2[0] - p[0])
        d = (ang2 - ang1) % (2 * math.pi)
        if d > math.pi:
            d -= 2 * math.pi
        for k in range(seg + 1):
            ang = ang1 + d * k / seg
            out.append((p[0] + rr * math.cos(ang), p[1] + rr * math.sin(ang)))
    return out


def clip_below(poly, h):
    """把多边形裁到水平线 y >= h 之下（桶里的水：水面必须是平的，不跟着桶斜）。"""
    out = []
    n = len(poly)
    for i in range(n):
        cur = poly[i]
        prv = poly[(i - 1) % n]
        cin = cur[1] >= h
        pin = prv[1] >= h
        if cin != pin:
            t = (h - prv[1]) / (cur[1] - prv[1])
            out.append((prv[0] + t * (cur[0] - prv[0]), h))
        if cin:
            out.append(cur)
    return out


def span_at(poly, y):
    """多边形在高度 y 处的左右边界（用于水面高光线与目标线不越出桶壁）。"""
    xs = []
    n = len(poly)
    for i in range(n):
        a = poly[i]
        b = poly[(i + 1) % n]
        if (a[1] <= y <= b[1]) or (b[1] <= y <= a[1]):
            if abs(a[1] - b[1]) < 1e-9:
                continue
            t = (y - a[1]) / (b[1] - a[1])
            xs.append(a[0] + t * (b[0] - a[0]))
    if len(xs) < 2:
        return None
    return min(xs), max(xs)


def stroke(d, pts, color, width):
    """描边用 line(joint='curve') 而不是 polygon(outline=)：多边形描边在尖角上会支出一截刺。"""
    d.line(sc(list(pts) + [pts[0]]), fill=color, width=int(width * S), joint='curve')


def ground(size):
    """深色径向底：跟 css/game.css 的 body 背景同一套方向（顶上亮、边上沉）。"""
    small = Image.new('RGB', (192, 192))
    px = small.load()
    cx, cy = 0.5, 0.02
    rad = 1.25
    for y in range(192):
        for x in range(192):
            dx = (x / 191.0 - cx) / rad
            dy = (y / 191.0 - cy) / (rad * 0.92)
            t = min(1.0, math.hypot(dx, dy)) ** 0.75
            px[x, y] = tuple(int(BG_TOP[i] + (BG_EDGE[i] - BG_TOP[i]) * t) for i in range(3))
    return small.resize((size, size), Image.LANCZOS)


def sheen(img, size):
    """一道斜向柔光：跟中央美术件同一记，免得两套图标看着不是一家人。"""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.polygon(sc([(150, -60), (420, -60), (-40, 760), (-260, 760)]), fill=26)
    mask = mask.filter(ImageFilter.GaussianBlur(size * 0.055))
    white = Image.new('RGB', (size, size), (255, 255, 255))
    out = img.convert('RGB').copy()
    out.paste(white, (0, 0), mask)   # mask 当 alpha 用：亮一道，不是刷一层白
    return out


def jug_geometry():
    """倾倒的桶：局部矩形 → 绕中心转 JUG_TILT 度 → 落到画布上。"""
    body = round_poly([(0, 0), (JUG_W, 0), (JUG_W, JUG_H), (0, JUG_H)], JUG_R, 12)
    pivot = (JUG_W / 2.0, JUG_H / 2.0)
    return [(x + JUG_X, y + JUG_Y) for (x, y) in rot(body, JUG_TILT, pivot)]


def receiver_geometry():
    """接水的桶：上宽下窄，像真的桶。"""
    return round_poly([(RCP_TOP_X[0], RCP_TOP), (RCP_TOP_X[1], RCP_TOP),
                       (RCP_BOT_X[1], RCP_BOT), (RCP_BOT_X[0], RCP_BOT)], RCP_R, 12)


def bezier(p0, p1, p2, n=64):
    out = []
    for i in range(n + 1):
        t = i / n
        u = 1 - t
        out.append((u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
                    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1]))
    return out


def draw_motif(size, scale=1.0):
    """画图形层（RGBA，透明底）；scale < 1 用在 maskable 的安全区上。

    画序有讲究：桶体 → 水 → 描边 → 水柱 → 桶壁描边。描边必须**后**画，否则水会把桶壁
    盖掉一半，桶看起来就没有壁了（第一版画出来正是这样）。
    """
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    jug = jug_geometry()
    rcp = receiver_geometry()

    # 桶体（先铺底）
    d.polygon(sc(rcp), fill=VESSEL_FILL + (255,))
    d.polygon(sc(jug), fill=VESSEL_FILL + (255,))

    # 两桶里的水：水面是平的（裁到水平线之下），不是跟着桶斜的
    for poly, level in ((rcp, WATER_LEVEL), (jug, JUG_WATER)):
        w = clip_below(poly, level)
        if len(w) >= 3:
            d.polygon(sc(w), fill=WATER + (255,))
            span = span_at(poly, level)
            if span:
                d.line(sc([(span[0], level), (span[1], level)]), fill=CYAN + (255,), width=6 * S)

    # 水柱：从倾倒桶的口沿落到接水桶的水面
    path = bezier((500, 214), (588, 372), (694, WATER_LEVEL - 4))
    left, right = [], []
    for i, (x, y) in enumerate(path):
        t = i / (len(path) - 1)
        w = (27 - 15 * t) * S
        if i == 0:
            dx, dy = path[1][0] - x, path[1][1] - y
        elif i == len(path) - 1:
            dx, dy = x - path[-2][0], y - path[-2][1]
        else:
            dx, dy = path[i + 1][0] - path[i - 1][0], path[i + 1][1] - path[i - 1][1]
        ln = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / ln * w / 2.0, dx / ln * w / 2.0
        left.append((x + nx, y + ny))
        right.append((x - nx, y - ny))
    d.polygon(sc(left + right[::-1]), fill=CYAN + (255,))
    for i, (x, y) in enumerate(path[::16]):
        r = (8 - 3.0 * (i / (len(path) / 16.0)))
        d.ellipse(sc([(x - r, y - r), (x + r, y + r)]), fill=WATER + (255,))

    # 桶壁描边：水柱之后画，接水桶的上沿正好压住水柱——水是从桶沿后面翻进去的
    stroke(d, rcp, INK + (255,), STROKE)
    stroke(d, jug, INK + (255,), STROKE)

    # 目标线：琥珀色虚线（面板上"目标"那一行就是这个颜色），不许越出桶壁
    span = span_at(rcp, TARGET_LINE)
    if span:
        x = span[0] + 10
        while x < span[1] - 26:
            d.line(sc([(x, TARGET_LINE), (x + 18, TARGET_LINE)]), fill=AMBER + (255,), width=9 * S)
            x += 34

    if scale != 1.0:
        n = int(size * scale)
        small = img.resize((n, n), Image.LANCZOS)
        out = Image.new('RGBA', (size, size), (0, 0, 0, 0))
        off = (size - n) // 2
        out.paste(small, (off, off), small)
        return out
    return img


def build_master():
    size = MASTER * S
    bg = ground(size).convert('RGBA')
    bg.alpha_composite(draw_motif(size))
    return sheen(bg, size).resize((MASTER, MASTER), Image.LANCZOS)


def build_maskable():
    """maskable：底满幅，图形缩进 80% 安全区（系统圆角/圆形遮罩裁不到主体）。"""
    size = MASTER * S
    bg = ground(size).convert('RGBA')
    bg.alpha_composite(draw_motif(size, scale=0.8))
    return sheen(bg, size).resize((MASTER, MASTER), Image.LANCZOS)


def png_size(path):
    """读 PNG 的 IHDR，拿真实宽高（不靠文件名说话）。"""
    with open(path, 'rb') as fh:
        head = fh.read(24)
    assert head[:8] == b'\x89PNG\r\n\x1a\n', path + ' 不是 PNG'
    return struct.unpack('>II', head[16:24])


def main():
    os.makedirs(OUT, exist_ok=True)
    master = build_master()
    maskable = build_maskable()
    files = {
        'icon-512.png': master.resize((512, 512), Image.LANCZOS),
        'icon-192.png': master.resize((192, 192), Image.LANCZOS),
        'icon-180.png': master.resize((180, 180), Image.LANCZOS),
        'apple-touch-icon.png': master.resize((180, 180), Image.LANCZOS),
        'icon-maskable-512.png': maskable.resize((512, 512), Image.LANCZOS),
        'icon-maskable-192.png': maskable.resize((192, 192), Image.LANCZOS),
        'favicon-32.png': master.resize((32, 32), Image.LANCZOS),
        'favicon-16.png': master.resize((16, 16), Image.LANCZOS),
    }
    for name, img in files.items():
        path = os.path.join(OUT, name)
        img.save(path, 'PNG', optimize=True)
        w, h = png_size(path)
        print('%-24s %dx%d  %6d B' % (name, w, h, os.path.getsize(path)))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
