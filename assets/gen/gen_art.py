#!/usr/bin/env python3
"""倒水量 POUR 美术资产工厂 —— 视觉母题 "measure"（无刻度量桶 / 水面高光 / 琥珀目标线）。

为什么在仓里自己写生成器：主编量具 `make_icons.py` 的 MOTIF 表里没有本仓（实测
`grep pour z-biz-game-lead/.../make_icons.py` 零命中），它只会给一个通用形状；而游戏内
真正要用的三样东西它根本不产 —— 工作台底纹、水滴 sprite、社交封面卡。开工前本仓是
`<link rel="icon" href="data:,">`（空 favicon）+ canvas 每帧 `fillRect` 糊纯色，没有任何位图。

母题与配色不凭空编，逐条来自本仓源码实测：
  背景 #0f1217 / #171a21、面板 #1b1f27            ← css/game.css :root
  水 #60bee8 → #1e5c8e（渐变两端）、高光 #bfe8ff   ← js/view.js WATER_TOP / WATER_BOT
  目标线 #e0a63c、水管 #8b95a5、铜嘴 #b4763f       ← css --amber / js/view.js STEEL / COPPER
  字形：等宽数字 + 桶壁上那一排没有数值的刻度      ← js/view.js drawBucket 的 graduation marks
形态语言：圆底量桶 + 一条横贯的琥珀"要量的那个数" + 暗场细颗粒。不画拟物玻璃高光，
因为这一局的核心是「读数」而不是「容器」——图标上那条琥珀线才是主角。

产出（路径即索引，全部真 PNG，无 SVG 冒充、无 0 字节）：
  icons/icon-<S>.png          S=64,96,192,512,1024  逐尺寸矢量重绘（小尺寸不糊）
  icons/icon-maskable-512.png                        同一构图收进 80% 安全区
  icons/favicon-16/32/48.png                         浏览器标签页用
  icons/apple-touch-icon.png                         180，实心不透明（iOS 不合成透明）
  assets/textures/bench-tile.png   256x256 RGBA 无缝平铺          canvas 工作台底纹
  assets/textures/backdrop.png     1024x640 RGB                   标题/面板底
  assets/sprites/droplet-sheet.png 512x128 RGBA 4 帧 128          水滴/涟漪精灵表
  assets/og/pour-og.png              1200x630 RGB                  og:image / twitter:image

可复现性硬约束：
  * 随机一律走本文件 LCG（固定 SEED），不调用 random / time / os.getpid / numpy；
  * 拉丁字用 Pillow 自带 Aileron（`ImageFont.load_default(size=)`），中文走候选字体表，
    一个都没有时退化成「纯图形 + 拉丁」锁版 —— 产物照样确定性生成，--verify 会如实报用了谁；
  * 同一 Pillow 版本下重跑，每个产物的 sha256 必须一致（`--hash` 打印校验）。

用法:
  python3 assets/gen/gen_art.py            # 生成全部
  python3 assets/gen/gen_art.py --verify   # 生成 + 读 PNG IHDR 核对宽高 + 核对页面引用存在
  python3 assets/gen/gen_art.py --hash     # 额外打印每个产物的 sha256（复现对拍用）
"""
import argparse
import hashlib
import math
import os
import struct
import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SEED = 0x50_4F_55_52  # "POUR"
FAVICON_SIZES = [16, 32, 48]                                  # 标签页/任务栏
LOGO_SIZES = [64, 96, 192, 512, 1024]                         # manifest 与站内大图标

# 逐条抄自 css/game.css 与 js/view.js，改这两个文件时这里要跟着改（--verify 会比对）
INK_BG = (15, 18, 23)        # #0f1217
INK_BG2 = (23, 26, 33)       # #171a21
PANEL = (27, 31, 39)         # #1b1f27
WATER_TOP = (96, 190, 232)   # rgba(96,190,232,.92)
WATER_BOT = (30, 92, 142)    # rgba(30,92,142,.95)
WATER_HI = (190, 232, 255)
AMBER = (224, 166, 60)       # --amber / NEED_LINE
STEEL = (139, 149, 165)      # view.js STEEL
COPPER = (180, 118, 63)      # view.js COPPER
INK = (230, 233, 239)
DIM = (143, 152, 168)

CJK_CANDIDATES = [
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Supplemental/Songti.ttc',
    '/Library/Fonts/Arial Unicode.ttf',
    '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
]


class Lcg:
    """唯一随机源：parked number 常数，跑几次都是同一串（可复现性的地基）。"""

    def __init__(self, seed=SEED):
        self.s = seed & 0xFFFFFFFF

    def next(self):
        self.s = (self.s * 1664525 + 1013904223) & 0xFFFFFFFF
        return self.s >> 8

    def uni(self):
        return (self.next() & 0xFFFFFF) / 0x1000000

    def span(self, a, b):
        return a + (b - a) * self.uni()

    def noise(self, w, h, amp, base=128):
        """整幅灰噪（不用 numpy，也不碰 Image.effect_noise —— 后者没有版本保证）。"""
        n = w * h
        out = bytearray(n)
        s = self.s
        for i in range(n):
            s = (s * 1664525 + 1013904223) & 0xFFFFFFFF
            out[i] = max(0, min(255, base + (((s >> 11) & 1023) * 2 // 1023 - 1) * amp))
        self.s = s
        return Image.frombytes('L', (w, h), bytes(out))


def mix(a, b, t):
    return tuple(int(round(a[i] * (1 - t) + b[i] * t)) for i in range(3))


def scale(v, S):
    """母图按 1024 设计，逐尺寸等比落位。"""
    return v * S / 1024.0


def field(S, cx=0.5, cy=0.42, rings=180):
    """暗场径向渐晕底：由外向内插值，画完轻微模糊去掉环带台阶。"""
    img = Image.new('RGB', (S, S), INK_BG)
    d = ImageDraw.Draw(img)
    r0 = math.hypot(S, S) * 0.5
    for i in range(rings, 0, -1):
        t = i / rings
        r = r0 * t
        d.ellipse([S * cx - r, S * cy - r, S * cx + r, S * cy + r], fill=mix(INK_BG2, INK_BG, t))
    return img.filter(ImageFilter.GaussianBlur(scale(1.6, S)))


def vgrad_box(box, stops):
    """竖向渐变贴片：先 1xN 条带再放大，避免逐像素循环。stops=[(pos,rgb),…]"""
    x0, y0, x1, y1 = [int(round(v)) for v in box]
    w, h = max(1, x1 - x0), max(1, y1 - y0)
    strip = Image.new('RGB', (1, 256))
    sd = strip.load()
    for y in range(256):
        t = y / 255
        for k in range(len(stops) - 1):
            p0, c0 = stops[k]
            p1, c1 = stops[k + 1]
            if t <= p1 or k == len(stops) - 2:
                u = 0 if p1 == p0 else max(0.0, min(1.0, (t - p0) / (p1 - p0)))
                sd[0, y] = mix(c0, c1, u)
                break
    return strip.resize((w, h), Image.BILINEAR), (x0, y0)


def grain(img, rng, amp=6, alpha=0.055):
    """细颗粒：灰噪叠加成低透明图层。所有位图统一过这一道，风格才连得住。"""
    w, h = img.size
    n = rng.noise(w, h, amp).convert('RGBA')
    n.putalpha(int(255 * alpha))
    img.paste(Image.alpha_composite(img.convert('RGBA'), n).convert(img.mode), (0, 0))
    return img


def rounded_bottom(d, box, r, **kw):
    """桶身形状与 js/view.js roundBottom 同构：平底圆角、口是直的。"""
    x0, y0, x1, y1 = box
    r = min(r, (x1 - x0) / 2, (y1 - y0) / 2)
    d.rectangle([x0, y0, x1, y1 - r], **kw)
    d.rectangle([x0, y1 - r, x1, y1], **kw)
    d.pieslice([x0, y1 - 2 * r, x0 + 2 * r, y1], 90, 180, **kw)
    d.pieslice([x1 - 2 * r, y1 - 2 * r, x1, y1], 0, 90, **kw)


def bucket(base, box, level, caps, need=None, detail=True):
    """画一只量桶（含水位、水面高光、无刻度桶壁上那一排只表意图的刻痕）。

    base 必须是 RGBA：在 RGB 底上 `ImageDraw.Draw(base, 'RGBA')` 会另开一张离屏层、
    等对象销毁才回贴，于是"先建 Draw 后 paste"的写法会把桶身笔迹整批丢掉（实测图标只剩水管）。
    所以这里先做贴片，最后才建落笔层。
    """
    x0, y0, x1, y1 = box
    w, h = x1 - x0, y1 - y0
    r = max(2, w * 0.16)
    body = [INK[0], INK[1], INK[2]]

    def local_mask(lx0, ly0, lx1, ly1, rad, value=255):
        """按贴片自身的尺寸建掩膜：paste 要求 src 与 mask 等大。
        取整必须与 vgrad_box 同一口径（round，不是 int 截断），否则差 1px 直接炸。"""
        mw, mh = max(1, int(round(lx1)) - int(round(lx0))), max(1, int(round(ly1)) - int(round(ly0)))
        m = Image.new('L', (mw, mh), 0)
        rounded_bottom(ImageDraw.Draw(m), (0, 0, mw, mh), rad, fill=value)
        return m

    # 玻璃体：桶轮廓内一层很淡的竖渐变（41 ≈ 255*0.16，靠掩膜亮度当不透明度）
    overlay, off = vgrad_box((x0, y0, x1, y1), [(0, mix(body, WATER_HI, 0.10)), (1, mix(body, WATER_BOT, 0.06))])
    base.paste(overlay, off, local_mask(x0, y0, x1, y1, r, 41))
    # 水
    wh = h * max(0.0, min(1.0, level))
    wy = y1 - wh
    if wh > 1:
        grad, goff = vgrad_box((x0 + 2, wy, x1 - 2, y1 - 1), [(0, WATER_TOP), (1, WATER_BOT)])
        base.paste(grad, goff, local_mask(x0 + 2, wy, x1 - 2, y1 - 1, max(1, r - 2)))
    d = ImageDraw.Draw(base, 'RGBA')
    if wh > 1:
        d.rectangle([x0 + 2, wy - max(1, w * 0.012), x1 - 2, wy + max(1, w * 0.006)], fill=WATER_HI + (215,))
    # 刻痕：无刻度是本局的题眼，所以只有短划、不写数字
    if detail and caps <= 12:
        tcol = (230, 232, 239, 56)
        for t in range(1, caps):
            y = y1 - h * t / caps
            long = (t * 2 == caps)
            d.line([x0 + w * 0.07, y, x0 + w * (0.30 if long else 0.15), y], fill=tcol,
                   width=max(1, int(w * 0.022)))
    # 桶沿与壁
    lw = max(2, int(w * 0.05))
    d.rounded_rectangle([x0, y0, x1, y1], radius=r, outline=(226, 232, 240, 92), width=lw)
    d.line([x0 - w * 0.06, y0, x1 + w * 0.06, y0], fill=(226, 232, 240, 150), width=lw)
    # 琥珀目标线：横贯本桶并探出两侧，正是游戏里那条 need line
    if need is not None:
        y = y1 - h * need
        d.line([x0 - w * 0.14, y, x1 + w * 0.14, y], fill=AMBER + (235,), width=max(2, int(w * 0.045)))
        if detail:
            d.line([x1 + w * 0.14, y, x1 + w * 0.20, y + h * 0.04], fill=AMBER + (150,),
                   width=max(1, int(w * 0.03)))


def font_stack(size, cjk=False):
    """拉丁走 Pillow 自带 Aileron（跨机器一致），中文走候选表；取不到返回 None 由调用方退化。"""
    if cjk:
        for p in CJK_CANDIDATES:
            if os.path.exists(p):
                try:
                    return ImageFont.truetype(p, size), os.path.basename(p)
                except OSError:
                    continue
        return None, None
    try:
        return ImageFont.load_default(size=size), 'Aileron(Pillow)'
    except TypeError:
        return ImageFont.load_default(), 'Pillow-default-bitmap'


def render_icon(S, detail=None, maskable=False):
    """逐尺寸重绘（不是把 1024 缩下来 —— 16px 缩下来只剩一坨）。

    maskable 与常规版共用同一构图：几何先在满幅设计空间里算好，再围绕中心乘 pad 收缩，
    所以商店里那张 maskable 只是同一张图收进 80% 安全区，不是另一套画法。
    底图一律转 RGBA：RGB 底上 `Draw(base, 'RGBA')` 是离屏层、退出作用域才回贴，
    会把后画的桶身盖掉（实测过，图标只剩水管）。
    """
    if detail is None:
        detail = S >= 260
    rng = Lcg(SEED ^ S)
    base = field(S, cx=0.5, cy=0.40, rings=max(40, min(180, S // 2))).convert('RGBA')
    d = ImageDraw.Draw(base, 'RGBA')
    pad = 0.72 if maskable else 1.0
    mid = S / 2.0

    def T(v):
        return mid + (v - mid) * pad

    def seg(x0, y0, x1, y1, **kw):
        d.line([T(x0), T(y0), T(x1), T(y1)], **kw)

    def box(x0, y0, x1, y1):
        return (T(x0), T(y0), T(x1), T(y1))

    u = pad * S  # 收缩后线宽要跟着缩，否则 maskable 版看起来更粗
    base_y = 0.80 * S
    # 台面基准线：桶站在这条线上，读作「操作台」而不是「三个柱状条」
    seg(0.06 * S, base_y, 0.94 * S, base_y, fill=(226, 232, 240, 40), width=max(1, int(u * 0.006)))
    # 顶部水管 + 铜嘴，点明「水从这儿来」
    if S >= 48:
        pw = max(2, int(u * 0.018))
        seg(0.50 * S, 0.17 * S, 0.70 * S, 0.17 * S, fill=STEEL + (200,), width=pw)
        seg(0.50 * S, 0.17 * S, 0.50 * S, 0.24 * S, fill=STEEL + (220,), width=pw)
        d.rectangle([T(0.488 * S), T(0.235 * S), T(0.545 * S), T(0.275 * S)], fill=COPPER + (255,))
    caps, levels = [3, 5, 8], [0.40, 1.00, 0.75]
    if S < 96:
        # 退化档：三只桶在 16px 下每只只有 2.8px 宽（实测连桶内高光都会画成 x1<x0 而抛错），
        # 所以小尺寸只留一只大桶 + 那条琥珀目标线，16px 下仍然读得出「量到这条线」。
        bw, bh = 0.46 * S, 0.50 * S
        bucket(base, box((S - bw) / 2, base_y - bh, (S + bw) / 2, base_y),
               0.75, 8, need=0.75, detail=False)
    else:
        w, gap, unit = 0.175 * S, 0.075 * S, 0.062 * S
        x0 = (S - (w * 3 + gap * 2)) / 2
        for i in range(3):
            bx0 = x0 + i * (w + gap)
            h = unit * caps[i]
            bucket(base, box(bx0, base_y - h, bx0 + w, base_y), levels[i], caps[i],
                   need=0.75 if i == 2 else None, detail=detail)
    grain(base, rng, amp=5, alpha=0.05 if S >= 128 else 0.03)
    return base.convert('RGB')


def bench_tile(rng):
    """256 无缝工作台底纹：拉丝横线 + 32px 弱网格 + 琥珀量点 + 水渍 + 颗粒。

    无缝性靠两条硬约束：周期图案的坐标只取 mod S，越界的水渍椭圆手工绕回贴九宫格，
    最后 0.45px 模糊只作用于环内像素、不破坏接缝。canvas 侧 createPattern 直接平铺。
    """
    S = 256
    img = Image.new('RGBA', (S, S), INK_BG + (255,))
    d = ImageDraw.Draw(img)
    for y in range(0, S, 3):                       # 拉丝：每 3px 一道，亮度由 LCG 决定
        c = int(20 + rng.span(0, 12))
        d.line([0, y, S, y], fill=(c + 6, c + 9, c + 14, 255), width=1)
    for g in range(0, S, 32):                      # 网格：两端各画一次保证接缝闭合
        for off in (g, g - S):
            d.line([off, 0, off, S], fill=(226, 232, 240, 14), width=1)
            d.line([0, off, S, off], fill=(226, 232, 240, 14), width=1)
    for t in range(0, S, 16):                      # 量点：每 16px 一枚琥珀短划，取模绕回
        d.line([t, S - 10, t + 6, S - 10], fill=AMBER + (52,), width=1)
    d.line([0, S - 12, S, S - 12], fill=AMBER + (38,), width=1)
    d.line([0, 11, S, 11], fill=WATER_HI + (20,), width=1)
    for _ in range(240):                           # 水渍斑点：小椭圆，越界的手工绕回贴
        x, y, r = rng.span(0, S), rng.span(0, S), rng.span(1.2, 4.2)
        col = (WATER_TOP[0], WATER_TOP[1], WATER_TOP[2], 24)
        for dx in (0, -S, S):
            for dy in (0, -S, S):
                d.ellipse([x + dx - r, y + dy - r, x + dx + r, y + dy + r], fill=col)
    img = img.filter(ImageFilter.GaussianBlur(0.45))
    grain(img, rng, amp=7, alpha=0.05)
    return img.convert('RGBA')


def backdrop():
    """1024x640 底：暗场 + 台面 + 远处五只桶剪影 + 左侧读数尺。标题/面板铺这张。"""
    W, H = 1024, 640
    rng = Lcg(SEED + 29)
    img, off = vgrad_box((0, 0, W, H), [(0, INK_BG2), (0.62, INK_BG), (1, (11, 14, 18))])
    img = img.convert('RGBA')
    d = ImageDraw.Draw(img)
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse([W * 0.18, -H * 0.55, W * 0.86, H * 0.95], fill=90)
    glow = glow.filter(ImageFilter.GaussianBlur(90))
    img.paste(WATER_BOT, (0, 0), glow)
    base_y = H * 0.80
    d.line([0, base_y, W, base_y], fill=(226, 232, 240, 34), width=2)
    caps = [3, 4, 5, 7, 8]
    unit = 26.0
    x = W * 0.10
    for i, c in enumerate(caps):
        bw = 96
        h = unit * c
        box = (x, base_y - h, x + bw, base_y)
        d.rounded_rectangle([box[0], box[1], box[2], box[3]], radius=14,
                            outline=(226, 232, 240, 30), width=3)
        if i % 2 == 0:
            d.rectangle([box[0] + 4, base_y - h * 0.55, box[2] - 4, base_y - 6], fill=WATER_BOT + (60,))
        x += bw + 78
    for y in range(int(H * 0.18), int(H * 0.78), 22):   # 左侧读数尺
        long = (y // 22) % 4 == 0
        d.line([26, y, 26 + (34 if long else 16), y], fill=AMBER + ((95 if long else 48),), width=2)
    d.line([26, H * 0.18, 26, H * 0.78], fill=AMBER + (70,), width=2)
    grain(img, rng, amp=8, alpha=0.05)
    return img.convert('RGB')


def droplet_sheet():
    """4 帧 128x128 精灵表：坠滴 → 起环 → 扩环 → 溅冠。帧序写死，游戏按索引取。"""
    F, S = 4, 128
    img = Image.new('RGBA', (F * S, S), (0, 0, 0, 0))
    rng = Lcg(SEED + 47)
    for f in range(F):
        d = ImageDraw.Draw(img, 'RGBA')
        ox = f * S
        cx, cy = ox + S / 2, S / 2
        if f == 0:                                    # 坠滴：上尖下圆 + 高光
            d.polygon([(cx, cy - 40), (cx - 22, cy + 2), (cx, cy + 34), (cx + 22, cy + 2)],
                      fill=WATER_TOP + (230,))
            d.ellipse([cx - 22, cy - 6, cx + 22, cy + 34], fill=WATER_TOP + (230,))
            d.ellipse([cx - 12, cy + 2, cx - 2, cy + 14], fill=WATER_HI + (200,))
            d.line([cx - 4, cy - 34, cx + 4, cy - 22], fill=WATER_HI + (150,), width=3)
        elif f in (1, 2):                             # 涟漪：同心环，外帧更淡更宽
            r = 26 if f == 1 else 46
            a = 200 if f == 1 else 120
            for k in range(3):
                rr = r + k * (10 if f == 1 else 12)
                d.ellipse([cx - rr, cy - rr * 0.42, cx + rr, cy + rr * 0.42],
                          outline=(WATER_TOP[0], WATER_TOP[1], WATER_TOP[2], max(0, a - k * 60)),
                          width=max(2, 6 - k))
        else:                                         # 溅冠：一圈上扬的小珠 + 底环
            d.ellipse([cx - 44, cy + 8, cx + 44, cy + 26], outline=WATER_TOP + (140,), width=3)
            for k in range(7):
                ang = math.pi * (0.12 + 0.76 * k / 6)
                px = cx - math.cos(ang) * 40
                py = cy + 6 - math.sin(ang) * 34
                d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=WATER_HI + (200,))
        _ = rng.uni()                                 # 保持 LCG 消费序列稳定（帧间扰动一致）
    return img


def og_card():
    """1200x630 社交卡：左侧标题锁版 + 读数尺，右侧三只真桶（复用 render_icon 的画法）。"""
    W, H = 1200, 630
    rng = Lcg(SEED + 71)
    img, off = vgrad_box((0, 0, W, H), [(0, INK_BG2), (0.55, INK_BG), (1, (10, 13, 17))])
    img = img.convert('RGBA')
    glow = Image.new('L', (W, H), 0)
    ImageDraw.Draw(glow).ellipse([W * 0.42, -H * 0.7, W * 1.16, H * 1.1], fill=110)
    img.paste(WATER_BOT, (0, 0), glow.filter(ImageFilter.GaussianBlur(80)))
    d = ImageDraw.Draw(img, 'RGBA')
    d.line([0, H * 0.86, W, H * 0.86], fill=(226, 232, 240, 40), width=2)
    # 右侧桶阵：容量 3/5/8，与图标同一组数字
    base_y = H * 0.86
    caps, levels = [3, 5, 8], [0.4, 1.0, 0.75]
    bw, gap, unit = 118, 46, 46.0
    x = W - (bw * 3 + gap * 2) - 84
    for i in range(3):
        box = (x + i * (bw + gap), base_y - unit * caps[i], x + i * (bw + gap) + bw, base_y)
        bucket(img, box, levels[i], caps[i], need=0.75 if i == 2 else None, detail=True)
    # 左侧文字
    big, bigsrc = font_stack(96, cjk=True)
    lat, latsrc = font_stack(30)
    small, _ = font_stack(22)
    ty = 96
    if big:
        d.text((84, ty), '倒水量', font=big, fill=INK + (255,))
        ty += 132
    else:
        lat2, _ = font_stack(72)
        d.text((84, ty), 'POUR', font=lat2, fill=INK + (255,))
        ty += 110
    d.text((84, ty), 'P O U R', font=lat, fill=WATER_TOP + (255,))
    ty += 54
    d.line([84, ty, 84 + 430, ty], fill=AMBER + (220,), width=3)
    ty += 26
    sub, _ = font_stack(28, cjk=True)
    for line in ['没刻度的桶，量出指定的数', '每一关的最少次数都是搜索量出来的']:
        d.text((84, ty), line, font=sub or lat, fill=DIM + (255,))
        ty += 46
    # 左缘读数尺：这一局的核心是「读数」
    for y in range(96, int(H * 0.8), 22):
        long = (y // 22) % 4 == 0
        d.line([40, y, 40 + (30 if long else 14), y], fill=AMBER + ((90 if long else 45),), width=2)
    d.line([40, 96, 40, int(H * 0.8)], fill=AMBER + (65,), width=2)
    d.text((84, H - 74), 'Electron · Canvas · gcd & BFS certified', font=small, fill=(226, 232, 240, 130))
    grain(img, rng, amp=7, alpha=0.05)
    return img.convert('RGB'), {'title': bigsrc or 'NONE(CJK)', 'latin': latsrc}


def write(path, im, hashes):
    full = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(full), exist_ok=True)
    im.save(full, 'PNG', optimize=True)
    if hashes is not None:
        hashes[path] = hashlib.sha256(open(full, 'rb').read()).hexdigest()[:16]
    print(f'  {path:44s} {os.path.getsize(full):>8,} B')


def png_ihdr(path):
    """stdlib 读 IHDR：证明盘上是真 PNG 且宽高如所声称（不许 SVG 冒充）。"""
    with open(path, 'rb') as f:
        head = f.read(33)
    if head[:8] != b'\x89PNG\r\n\x1a\n' or head[12:16] != b'IHDR':
        return None
    w, h, depth, ctype = struct.unpack('>IIBB', head[16:26])
    return w, h, depth, ctype


def verify(hashes=None):
    """产物宽高对拍 + 页面引用路径存在性对拍（index.html / manifest 里写了就必须有）。"""
    expect = {f'icons/icon-{s}.png': (s, s) for s in LOGO_SIZES}
    expect.update({f'icons/favicon-{s}.png': (s, s) for s in FAVICON_SIZES})
    expect.update({
        'icons/icon-maskable-512.png': (512, 512),
        'icons/apple-touch-icon.png': (180, 180),
        'assets/textures/bench-tile.png': (256, 256),
        'assets/textures/backdrop.png': (1024, 640),
        'assets/sprites/droplet-sheet.png': (512, 128),
        'assets/og/pour-og.png': (1200, 630),
    })
    bad = []
    for rel, (ew, eh) in sorted(expect.items()):
        p = os.path.join(ROOT, rel)
        if not os.path.exists(p):
            bad.append(f'{rel}: 缺文件')
            continue
        ih = png_ihdr(p)
        if not ih:
            bad.append(f'{rel}: 不是真 PNG')
            continue
        if ih[0] != ew or ih[1] != eh:
            bad.append(f'{rel}: IHDR {ih[0]}x{ih[1]} ≠ 声称 {ew}x{eh}')
    print(f'IHDR 对拍：{len(expect)} 张，异常 {len(bad)}')
    for b in bad:
        print('  ✗', b)
    # 引用面：html/manifest 里出现的每个本地路径都得在盘上
    refs = []
    for rel in ('index.html', 'manifest.webmanifest'):
        p = os.path.join(ROOT, rel)
        if os.path.exists(p):
            src = open(p, encoding='utf-8', errors='ignore').read()
            for m in __import__('re').finditer(r'["\'](icons/[\w./-]+|assets/[\w./-]+|manifest\.webmanifest)["\']', src):
                refs.append(m.group(1))
    miss = sorted({r for r in refs if not os.path.exists(os.path.join(ROOT, r.split('?')[0]))})
    print(f'页面引用：{len(set(refs))} 个本地路径，缺失 {len(miss)}')
    for m in miss:
        print('  ✗ 引用了但盘上没有:', m)
    if hashes is not None:
        for rel, h in sorted(hashes.items()):
            print(f'  sha256:{h}  {rel}')
    return 0 if not bad and not miss else 1


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--verify', action='store_true')
    ap.add_argument('--hash', action='store_true')
    ap.add_argument('--no-gen', action='store_true', help='只校验，不重画')
    a = ap.parse_args()
    hashes = {} if a.hash else None
    if not a.no_gen:
        print(f'生成（SEED=0x{SEED:08X}，Pillow 版本 {Image.__version__}）')
        for s in LOGO_SIZES:
            write(f'icons/icon-{s}.png', render_icon(s), hashes)
        for s in FAVICON_SIZES:
            write(f'icons/favicon-{s}.png', render_icon(s), hashes)
        write('icons/apple-touch-icon.png', render_icon(180), hashes)
        write('icons/icon-maskable-512.png', render_icon(512, maskable=True), hashes)
        write('assets/textures/bench-tile.png', bench_tile(Lcg(SEED + 11)), hashes)
        write('assets/textures/backdrop.png', backdrop(), hashes)
        write('assets/sprites/droplet-sheet.png', droplet_sheet(), hashes)
        card, used = og_card()
        write('assets/og/pour-og.png', card, hashes)
        print(f'  字体：标题 {used["title"]} · 拉丁 {used["latin"]}')
    if a.verify or a.hash:
        sys.exit(verify(hashes))


if __name__ == '__main__':
    main()
