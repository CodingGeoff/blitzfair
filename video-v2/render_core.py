#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BlitzFair V2 影片渲染器
1920x1080 @ 30fps，中文运动图形图表 + 旁白 + 字幕
场景时长由旁白音频实际长度驱动（见 /tmp/voice_durations.json）
"""
import math, os, sys, json, random, subprocess
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

W, H, FPS = 1920, 1080, 30
HERE = os.path.dirname(os.path.abspath(__file__))
VOICE_DIR = os.path.join(HERE, 'assets', 'voice-v2')
OUT = os.path.join(HERE, 'assets', 'blitzfair-v2-sybil.mp4')
BGMWAV = '/tmp/video/bgm.wav'

F_BOLD = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
F_REG  = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc'
F_SER  = '/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc'
F_MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
F_MONO_R = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'

def font(p, s):
    try: return ImageFont.truetype(p, s)
    except Exception: return ImageFont.truetype(F_BOLD, s)

# ---------- 配色 ----------
BG_TOP   = (16, 12, 38)
BG_BOT   = (9, 7, 24)
CARD     = (27, 23, 54)
CARD2    = (35, 30, 72)
LINE     = (58, 51, 104)
ACCENT   = (131, 110, 249)    # Monad 紫
ACCENT2  = (196, 181, 253)
WHITE    = (245, 243, 255)
GREY     = (150, 145, 188)
GREY_D   = (96, 91, 130)
RED      = (248, 113, 113)
AMBER    = (251, 191, 36)
GREEN    = (52, 211, 153)
CYAN     = (103, 232, 249)

# ============================================================
# 基础工具
# ============================================================
def ease_out(x):
    x = max(0.0, min(1.0, x))
    return 1 - (1 - x) ** 3

def ease_in_out(x):
    x = max(0.0, min(1.0, x))
    return 3 * x * x - 2 * x * x * x

def clamp01(x):
    return max(0.0, min(1.0, x))

_seg = lambda t, a, b: clamp01((t - a) / (b - a)) if b > a else 0.0

def text_w(draw, s, f):
    b = draw.textbbox((0, 0), s, font=f)
    return b[2] - b[0]

def draw_text(d, xy, s, f, fill, anchor='la', spacing=0):
    d.text(xy, s, font=f, fill=fill, anchor=anchor, spacing=spacing)

def wrap(d, s, f, maxw):
    lines, cur = [], ''
    for ch in s:
        if ch == '\n':
            lines.append(cur); cur = ''; continue
        if text_w(d, cur + ch, f) > maxw and cur:
            lines.append(cur); cur = ch
        else:
            cur += ch
    if cur: lines.append(cur)
    return lines

def make_bg():
    top = np.array(BG_TOP, np.float32); bot = np.array(BG_BOT, np.float32)
    g = np.linspace(0, 1, H, dtype=np.float32)[:, None]
    arr = (top[None, :] * (1 - g) + bot * g).astype(np.uint8)
    arr = np.repeat(arr[:, None, :], W, axis=1)
    img = Image.fromarray(arr).convert('RGB')
    # 网格
    ov = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(ov)
    for x in range(0, W, 80):
        od.line([(x, 0), (x, H)], fill=(255, 255, 255, 5))
    for y in range(0, H, 80):
        od.line([(0, y), (W, y)], fill=(255, 255, 255, 5))
    img = Image.alpha_composite(img.convert('RGBA'), ov).convert('RGB')
    # 顶部紫光晕
    glow = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([W * 0.15, -H * 0.75, W * 0.85, H * 0.42], fill=(131, 110, 249, 26))
    glow = glow.filter(ImageFilter.GaussianBlur(140))
    return Image.alpha_composite(img.convert('RGBA'), glow).convert('RGB')

BG = make_bg()

def glow_circle(size, color, blur=18):
    im = Image.new('RGBA', (size * 2, size * 2), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    d.ellipse([size * .35, size * .35, size * 1.65, size * 1.65], fill=color + (150,))
    return im.filter(ImageFilter.GaussianBlur(blur))

def paste_center(base, im, cx, cy, alpha=1.0):
    if alpha <= 0.01: return
    if alpha < 1.0:
        im = im.copy()
        a = im.split()[3].point(lambda v: int(v * alpha))
        im.putalpha(a)
    base.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

# ============================================================
# 图表元件
# ============================================================
def card(d, box, fill=CARD, outline=None, r=22, width=2):
    if outline:
        d.rounded_rectangle(box, radius=r, outline=outline, width=width, fill=fill)
    else:
        d.rounded_rectangle(box, radius=r, fill=fill)

def wallet_icon(d, cx, cy, s, state='idle', alpha=255):
    """钱包图标：idle=灰 / win=绿 / lose=暗红"""
    col = {'idle': (78, 72, 118), 'win': GREEN, 'lose': (70, 50, 60)}[state]
    glowc = {'idle': (131, 110, 249), 'win': GREEN, 'lose': RED}[state]
    w, h = s, s * 0.78
    # 光晕
    if state != 'idle':
        d.rounded_rectangle([cx - w / 2 - 5, cy - h / 2 - 5, cx + w / 2 + 5, cy + h / 2 + 5],
                            radius=9, fill=glowc + (38,))
    d.rounded_rectangle([cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2], radius=6,
                        fill=col + (alpha,), outline=glowc + (alpha,), width=2)
    # 卡扣
    d.rounded_rectangle([cx + w / 2 - 9, cy - h * 0.16, cx + w / 2 + 2, cy + h * 0.16],
                        radius=3, fill=(BG_TOP + (alpha,)))

def person_icon(d, cx, cy, s, col, alpha=255):
    """人形剪影"""
    r = s * 0.26
    d.ellipse([cx - r, cy - s * 0.46 - r, cx + r, cy - s * 0.46 + r], fill=col + (alpha,))
    d.rounded_rectangle([cx - s * 0.34, cy - s * 0.10, cx + s * 0.34, cy + s * 0.5],
                        radius=int(s * 0.17), fill=col + (alpha,))

def bar(d, x, y, w, h, frac, col, bg=TRACK if 'TRACK' in dir() else (38, 34, 74), r=6):
    d.rounded_rectangle([x, y, x + w, y + h], radius=r, fill=bg)
    if frac > 0:
        d.rounded_rectangle([x, y, x + max(h, w * frac), y + h], radius=r, fill=col)

TRACK = (40, 35, 78)

# ============================================================
# 字幕
# ============================================================
SUB_F = font(F_BOLD, 42)

def draw_subtitle(img, txt, alpha=1.0):
    if not txt or alpha <= 0.01: return img
    d = ImageDraw.Draw(img)
    lines = wrap(d, txt, SUB_F, W * 0.80)
    lh = 54
    total_h = lh * len(lines)
    y0 = H - 96 - total_h + lh * 0.5
    # 背板
    pad = 26
    boxw = max(text_w(d, l, SUB_F) for l in lines) + pad * 2
    bx0 = W / 2 - boxw / 2; by0 = y0 - lh * 0.5 - pad * 0.7
    overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)
    od.rounded_rectangle([bx0, by0, bx0 + boxw, by0 + total_h + pad * 1.4], radius=16,
                         fill=(8, 6, 20, int(190 * alpha)))
    img.alpha_composite(overlay)
    d = ImageDraw.Draw(img)
    for i, l in enumerate(lines):
        d.text((W / 2, y0 + i * lh), l, font=SUB_F, anchor='mm',
               fill=WHITE + (int(255 * alpha),),
               stroke_width=3, stroke_fill=(8, 6, 20, int(220 * alpha)))
    return img

# ============================================================
# 页眉 / 页脚
# ============================================================
def header(img, d, title, kicker=None, alpha=1.0):
    """页眉：kicker 小字在上，标题大字在下，禁用重叠"""
    a = int(255 * alpha)
    if kicker:
        d.text((96, 40), kicker, font=font(F_BOLD, 24), fill=ACCENT2 + (a,), anchor='la')
        d.text((96, 72), title, font=font(F_BOLD, 42), fill=WHITE + (a,), anchor='la')
        d.line([(96, 138), (W - 96, 138)], fill=LINE + (int(120 * alpha),), width=2)
    else:
        d.text((96, 56), title, font=font(F_BOLD, 44), fill=WHITE + (a,), anchor='la')
        d.line([(96, 118), (W - 96, 118)], fill=LINE + (int(120 * alpha),), width=2)

def footer(d, idx, total, alpha=1.0):
    a = int(200 * alpha)
    d.text((96, H - 42), 'BlitzFair V2 · 女巫攻击防御', font=font(F_REG, 22), fill=GREY_D + (a,))
    d.text((W - 96, H - 42), f'{idx} / {total}', font=font(F_MONO_R, 22), fill=GREY_D + (a,), anchor='ra')
