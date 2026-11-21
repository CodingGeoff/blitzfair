#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""场景实现：S1..S11（S1-S6 对应六段旁白，内部再分镜）"""

import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from render_core import *

random.seed(7)

# ---------- 每幕内部的子镜头切换点（占该幕时长的比例） ----------
# S1: 50 个钱包亮起 / 抢票结果 / 定义 / 漏洞陈述
S1_CUTS = [0.00, 0.30, 0.58, 0.80]
# S2: 实测柱状图 / "不是运气是数学" / 第二个洞 / 两个问题
S2_CUTS = [0.00, 0.42, 0.62, 0.84]
# S3: 保证金三态 / 免费占位变成本 / 可计算
S3_CUTS = [0.00, 0.62, 0.82]
# S4: 加权抽签原理 / 累积权重掷点 / 女巫中性 / 开关
S4_CUTS = [0.00, 0.42, 0.70, 0.90]
# S5: 测试大数字 / 对照柱状 / 非法路径 / 账目
S5_CUTS = [0.00, 0.30, 0.58, 0.80]
# S6: 三行金句 / 收尾
S6_CUTS = [0.00, 0.62]

def sub_index(t, dur, cuts):
    frac = t / max(dur, 1e-6)
    for i in range(len(cuts) - 1, -1, -1):
        if frac >= cuts[i]:
            return i
    return 0

# ============================================================
# S1 · 故事：一个人，五十个号
# ============================================================
def s1(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S1_CUTS)
    local = t - S1_CUTS[i] * dur
    span = (S1_CUTS[i + 1] - S1_CUTS[i]) * dur if i + 1 < len(S1_CUTS) else dur - S1_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    # ---------------- 幕 0：50 个钱包逐个亮起 ----------------
    if i == 0:
        cx, cy = W * 0.5, H * 0.54
        # 中心背板：遮住穿过的连线，保证头像与文字清晰
        d.ellipse([cx - 158, cy - 190, cx + 158, cy + 118], fill=(13, 10, 32, 255))
        d.ellipse([cx - 158, cy - 190, cx + 158, cy + 118], outline=ACCENT + (80,), width=2)
        # 中心攻击者
        person_icon(d, cx, cy - 78, 150, ACCENT2, 240)
        d.text((cx, cy + 62), '一个人', font=font(F_BOLD, 42), fill=ACCENT2 + (240,), anchor='mm')
        # 50 个钱包环形排布
        n = 50
        shown = ease_out(clamp01(p / 0.82)) * n
        for k in range(n):
            if k >= shown + 0.001: break
            ang = -math.pi / 2 + k * (2 * math.pi / n) + 0.12 * math.sin(k * 1.7)
            rad = 318 + 30 * math.sin(k * 2.3)
            wx = cx + math.cos(ang) * rad * 1.42
            wy = cy - 40 + math.sin(ang) * rad * 0.80
            appear = clamp01(shown - k)
            s = 44 * (0.6 + 0.4 * ease_out(appear))
            a = int(255 * clamp01(appear * 1.6))
            wallet_icon(d, wx, wy, s, 'idle', a)
            # 连向中心的细线
            if appear > 0.35:
                la = int(70 * clamp01((appear - 0.35) / 0.65))
                dx, dy = wx - cx, wy - cy
                dist = max((dx * dx + dy * dy) ** 0.5, 1e-6)
                sx0, sy0 = cx + dx / dist * 162, cy + dy / dist * 138
                d.line([(sx0, sy0), (wx, wy)], fill=ACCENT + (la,), width=1)
        # 计数器
        cnt = int(shown)
        d.text((cx, 132), f'{cnt}', font=font(F_MONO, 92), fill=RED + (240,), anchor='mm')
        d.text((cx, 188), '个钱包 · 同一个人的', font=font(F_REG, 28), fill=GREY + (220,), anchor='mm')

    # ---------------- 幕 1：抢票结果 ----------------
    elif i == 1:
        d.text((130, 96), '五十张票，全是他的', font=font(F_BOLD, 52), fill=WHITE + (250,), anchor='la')
        # 左：攻击方 50 个绿点（放大、居中占左半屏）
        d.text((200, 196), '攻击方 · 50 个号', font=font(F_BOLD, 30), fill=RED + (225,), anchor='la')
        prog = ease_out(clamp01(p / 0.55))
        cols = 10
        for k in range(50):
            if k / 50 > prog: break
            cxx = 226 + (k % cols) * 78
            cyy = 292 + (k // cols) * 78
            wallet_icon(d, cxx, cyy, 54, 'win', 245)
        # 右：9 个真实用户（放右侧独立区域，文字在下）
        d.text((1330, 196), '真实买家 · 9 个人', font=font(F_BOLD, 30), fill=GREY + (225,), anchor='la')
        prog2 = ease_out(clamp01((p - 0.45) / 0.5))
        for k in range(9):
            cxx = 1362 + (k % 3) * 132
            cyy = 300 + (k // 3) * 132
            st = 'lose' if k / 9 < prog2 else 'idle'
            person_icon(d, cxx, cyy, 76, (GREY_D if st == 'lose' else GREY), 215)
        if prog2 > 0.6:
            aa = int(255 * clamp01((prog2 - 0.6) / 0.4))
            d.text((1362 + 132, 300 + 2 * 132 + 84), '全部落空', font=font(F_BOLD, 42), fill=RED + (aa,), anchor='mm')
        # 中签结果条（上移到字幕之上）
        if p > 0.55:
            a = int(255 * ease_out(clamp01((p - 0.55) / 0.35)))
            d.rounded_rectangle([130, 730, W - 130, 812], radius=16, fill=(45, 22, 32, int(210 * a / 255)),
                                outline=RED + (a,), width=2)
            d.text((W / 2, 771), '10 张门票 → 攻击方 10 张 · 真实用户 0 张',
                   font=font(F_BOLD, 38), fill=RED + (a,), anchor='mm')

    # ---------------- 幕 2：女巫攻击定义 ----------------
    elif i == 2:
        a1 = ease_out(clamp01(p / 0.4))
        d.text((W / 2, 320), '女巫攻击', font=font(F_SER, 130), fill=WHITE + (int(255 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.3) / 0.4))
        d.text((W / 2, 430), 'Sybil Attack', font=font(F_MONO, 54), fill=ACCENT2 + (int(230 * a2),), anchor='mm')
        a3 = ease_out(clamp01((p - 0.5) / 0.4))
        d.line([(W / 2 - 300, 500), (W / 2 + 300, 500)], fill=ACCENT + (int(180 * a3),), width=2)
        d.text((W / 2, 600), '它不攻击代码，', font=font(F_BOLD, 56), fill=GREY + (int(240 * a3),), anchor='mm')
        d.text((W / 2, 686), '它攻击的是「一个地址 = 一个人」这个假设',
               font=font(F_BOLD, 56), fill=WHITE + (int(250 * a3),), anchor='mm')

    # ---------------- 幕 3：V1 的漏洞 ----------------
    else:
        a1 = ease_out(clamp01(p / 0.35))
        d.text((W / 2, 260), 'V1 解决了速度竞赛', font=font(F_BOLD, 54), fill=GREEN + (int(240 * a1),), anchor='mm')
        d.text((W / 2, 330), '谁的网快谁赢  →  公开抽签', font=font(F_REG, 36), fill=GREY + (int(230 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.42) / 0.38))
        if a2 > 0:
            d.line([(W / 2 - 420, 420), (W / 2 + 420, 420)], fill=LINE + (int(160 * a2),), width=2)
            d.text((W / 2, 545), '但抽签是等概率的', font=font(F_BOLD, 52), fill=WHITE + (int(250 * a2),), anchor='mm')
            d.text((W / 2, 650), '开多少号，就几倍胜率', font=font(F_SER, 84), fill=RED + (int(255 * a2),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')

# ============================================================
# S2 · 诊断：把漏洞数字化
# ============================================================
def s2(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S2_CUTS)
    local = t - S2_CUTS[i] * dur
    span = (S2_CUTS[i + 1] - S2_CUTS[i]) * dur if i + 1 < len(S2_CUTS) else dur - S2_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    # ---------------- 幕 0：6 回合柱状图 ----------------
    if i == 0:
        header(img, d, '实测：等概率模式下的 6 个回合', '诊断 · 把漏洞数字化')
        # 图例
        d.rounded_rectangle([96, 170, 116, 194], radius=5, fill=RED + (240,))
        d.text((130, 182), '攻击方（5 个小号）', font=font(F_BOLD, 26), fill=GREY + (240,), anchor='lm')
        d.rounded_rectangle([400, 170, 420, 194], radius=5, fill=GREEN + (240,))
        d.text((434, 182), '诚实用户（1 个地址）', font=font(F_BOLD, 26), fill=GREY + (240,), anchor='lm')

        # 6 组柱子：实际结果 攻击方 4 / 诚实 2
        results = ['A', 'A', 'A', 'H', 'A', 'H']
        base_y = 830
        gw = 240
        x0 = 190
        reveal = ease_out(clamp01(p / 0.62))
        for k in range(6):
            gx = x0 + k * gw
            prog = clamp01((reveal * 6.6) - k)
            # 攻击方柱
            ah = 420 * (1 if results[k] == 'A' else 0.52)
            hh = 420 * (1 if results[k] == 'H' else 0.52)
            ha = ah * ease_out(clamp01(prog))
            hh2 = hh * ease_out(clamp01(prog))
            if ha > 2:
                d.rounded_rectangle([gx - 62, base_y - ha, gx - 12, base_y], radius=8,
                                    fill=(RED + (215,)) if results[k] == 'A' else (95, 55, 62, 190))
            if hh2 > 2:
                d.rounded_rectangle([gx + 12, base_y - hh2, gx + 62, base_y], radius=8,
                                    fill=(GREEN + (215,)) if results[k] == 'H' else (45, 85, 72, 190))
            if prog > 0.95:
                d.text((gx, base_y + 30), f'回合 {k + 1}', font=font(F_REG, 24), fill=GREY + (220,), anchor='mm')
                if results[k] == 'A':
                    d.text((gx - 37, base_y - ah - 26), '攻', font=font(F_BOLD, 24), fill=RED + (235,), anchor='mm')
                else:
                    d.text((gx + 37, base_y - hh - 26), '诚', font=font(F_BOLD, 24), fill=GREEN + (235,), anchor='mm')
        d.line([(96, base_y + 4), (W - 96, base_y + 4)], fill=LINE + (200,), width=2)
        # 结论
        if p > 0.6:
            a = int(255 * ease_out(clamp01((p - 0.6) / 0.3)))
            d.rounded_rectangle([96, 900, W - 96, 980], radius=16, fill=(40, 24, 30, int(215 * a / 255)),
                                outline=RED + (a,), width=2)
            d.text((W / 2, 940), '攻击方 4 : 2   →   5 个号换来了 5 倍入场权重',
                   font=font(F_BOLD, 40), fill=RED + (a,), anchor='mm')

    # ---------------- 幕 1：不是运气，是数学 ----------------
    elif i == 1:
        a1 = ease_out(clamp01(p / 0.35))
        d.text((W / 2, 300), '不是运气', font=font(F_SER, 100), fill=WHITE + (int(255 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.3) / 0.35))
        d.text((W / 2, 440), '是数学', font=font(F_SER, 100), fill=RED + (int(255 * a2),), anchor='mm')
        a3 = ease_out(clamp01((p - 0.55) / 0.4))
        # 等式
        d.text((W / 2, 640), '地址数量', font=font(F_BOLD, 62), fill=WHITE + (int(250 * a3),), anchor='mm')
        d.text((W / 2, 740), '中签概率', font=font(F_BOLD, 62), fill=ACCENT2 + (int(250 * a3),), anchor='mm')
        if a3 > 0.2:
            # 右箭头
            d.polygon([(W / 2 + 220, 690), (W / 2 + 300, 690), (W / 2 + 300, 660),
                       (W / 2 + 350, 690), (W / 2 + 300, 720), (W / 2 + 300, 690)],
                      fill=AMBER + (int(220 * a3),))
        d.text((W / 2, 720), '等概率模式：每个地址权重完全相同', font=font(F_REG, 32),
               fill=GREY + (int(220 * a3),), anchor='mm')

    # ---------------- 幕 2：第二个洞 ----------------
    elif i == 2:
        header(img, d, '第二个洞：占位不给钱', '诊断 · 免费的成本')
        # 路径 A：走完流程
        a1 = ease_out(clamp01(p / 0.45))
        card(d, [96, 210, 900, 400], fill=(24, 40, 34, 190), outline=GREEN + (140,), r=18)
        d.text((150, 258), '路径 A · 正常买家', font=font(F_BOLD, 32), fill=GREEN + (240,), anchor='la')
        d.text((150, 318), '提交押金  →  按时揭示  →  进入候选池', font=font(F_REG, 30),
               fill=WHITE + (235,), anchor='la')
        d.text((150, 366), '成本：gas 费', font=font(F_BOLD, 26), fill=GREY + (220,), anchor='la')
        # 路径 B：不揭示
        card(d, [96, 440, 900, 630], fill=(44, 22, 30, 190), outline=RED + (150,), r=18)
        d.text((150, 488), '路径 B · 恶意占位', font=font(F_BOLD, 32), fill=RED + (240,), anchor='la')
        d.text((150, 548), '批量提交  →  永不揭示  →  白占名额', font=font(F_REG, 30),
               fill=WHITE + (235,), anchor='la')
        if p > 0.35:
            aa = int(255 * ease_out(clamp01((p - 0.35) / 0.3)))
            d.text((150, 596), '成本：0   （还能拉低别人中签率）', font=font(F_BOLD, 26),
                   fill=RED + (aa,), anchor='la')
        # 右侧后果
        if p > 0.55:
            aa2 = int(255 * ease_out(clamp01((p - 0.55) / 0.35)))
            x = 1010
            for k, (label, val, col) in enumerate([
                ('名额被白占', '名额浪费', RED),
                ('诚实用户', '中签率被稀释', AMBER),
                ('攻击者付出', '¥ 0', RED),
            ]):
                yy = 250 + k * 150
                d.text((x, yy), label, font=font(F_REG, 28), fill=GREY + (aa2,), anchor='la')
                d.text((x, yy + 44), val, font=font(F_BOLD, 44), fill=col + (aa2,), anchor='la')

    # ---------------- 幕 3：两个问题 ----------------
    else:
        d.text((W / 2, 200), '所以 V2 要回答两个问题', font=font(F_BOLD, 46), fill=GREY + (240,), anchor='mm')
        a1 = ease_out(clamp01(p / 0.4))
        card(d, [180, 300, W - 180, 480], fill=CARD2, outline=ACCENT + (150,), r=20)
        d.text((250, 350), '问题一', font=font(F_BOLD, 30), fill=ACCENT2 + (int(240 * a1),), anchor='la')
        d.text((250, 405), '怎么让「堆号」不划算？', font=font(F_BOLD, 54), fill=WHITE + (int(250 * a1),), anchor='la')
        a2 = ease_out(clamp01((p - 0.42) / 0.45))
        card(d, [180, 530, W - 180, 710], fill=CARD2, outline=ACCENT + (150,), r=20)
        d.text((250, 580), '问题二', font=font(F_BOLD, 30), fill=ACCENT2 + (int(240 * a2),), anchor='la')
        d.text((250, 635), '怎么让「占位不给钱」变成亏本生意？', font=font(F_BOLD, 54), fill=WHITE + (int(250 * a2),), anchor='la')
        a3 = ease_out(clamp01((p - 0.8) / 0.2))
        d.text((W / 2, 800), '答案就是 V2 的两层防御', font=font(F_REG, 34), fill=GREEN + (int(240 * a3),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')

# ============================================================
# S3 · 第一层：保证金
# ============================================================
def s3(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S3_CUTS)
    local = t - S3_CUTS[i] * dur
    span = (S3_CUTS[i + 1] - S3_CUTS[i]) * dur if i + 1 < len(S3_CUTS) else dur - S3_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    # ---------------- 幕 0：保证金三态生命周期 ----------------
    if i == 0:
        header(img, d, '第一层防御 · 保证金（bond）', '防御 1/2 · 让占位有成本')
        # 三个阶段卡片
        stages = [
            ('① 提交', '押金随单缴纳', 'stake + bond', AMBER),
            ('② 揭示', '保证金全额退回', 'bond refunded', GREEN),
            ('③ 不揭示', '保证金没收 → 发行方', 'bond forfeited', RED),
        ]
        appear = [clamp01(p * 4 - 0.4), clamp01(p * 4 - 1.4), clamp01(p * 4 - 2.4)]
        for k, (title, desc, code, col) in enumerate(stages):
            a = ease_out(appear[k])
            if a <= 0.01: continue
            x0 = 96 + k * 596
            box = [x0, 240, x0 + 540, 560]
            d.rounded_rectangle(box, radius=20, fill=(26, 22, 52, int(235 * a)), outline=col + (int(200 * a),), width=3)
            d.text((x0 + 270, 300), title, font=font(F_BOLD, 46), fill=col + (int(250 * a),), anchor='mm')
            d.text((x0 + 270, 390), desc, font=font(F_BOLD, 32), fill=WHITE + (int(240 * a),), anchor='mm')
            d.text((x0 + 270, 470), code, font=font(F_MONO, 26), fill=GREY + (int(230 * a),), anchor='mm')
            # 金额
            if k == 0:
                amt, amtcol = '− bond', AMBER
            elif k == 1:
                amt, amtcol = '+ bond', GREEN
            else:
                amt, amtcol = '− bond', RED
            d.text((x0 + 270, 522), amt, font=font(F_MONO, 34), fill=amtcol + (int(240 * a),), anchor='mm')
        # 箭头
        for k in range(2):
            if appear[k] > 0.6:
                aa = int(200 * clamp01((appear[k] - 0.6) / 0.4))
                xa = 96 + k * 596 + 540
                d.polygon([(xa + 14, 400), (xa + 42, 400), (xa + 42, 380), (xa + 62, 408),
                           (xa + 42, 436), (xa + 42, 416), (xa + 14, 416)], fill=GREY + (aa,))
        # 结论条
        if p > 0.62:
            a = int(255 * ease_out(clamp01((p - 0.62) / 0.3)))
            d.rounded_rectangle([96, 620, W - 96, 700], radius=16, fill=(24, 40, 34, int(200 * a / 255)),
                                outline=GREEN + (a,), width=2)
            d.text((W / 2, 660), '走完流程 → 一分不损失　　不揭示 → 真金白银亏掉',
                   font=font(F_BOLD, 36), fill=GREEN + (a,), anchor='mm')

    # ---------------- 幕 1：免费占位变成固定成本 ----------------
    elif i == 1:
        d.text((W / 2, 210), '「免费占位」  变成  「每单固定成本」',
               font=font(F_BOLD, 56), fill=WHITE + (250,), anchor='mm')
        # 100 个号的可视化：每个号下面标 ×bond
        rows, cols = 5, 20
        appear = ease_out(clamp01(p / 0.55))
        total = 0
        for k in range(100):
            if k / 100 > appear * 1.05: break
            cxx = 210 + (k % cols) * 78
            cyy = 330 + (k // cols) * 96
            aa = int(255 * clamp01(appear * 1.3 - k / 100 * 0.3))
            wallet_icon(d, cxx, cyy, 46, 'idle', aa)
            d.text((cxx, cyy + 40), '×bond', font=font(F_MONO_R, 15), fill=RED + (int(180 * aa / 255),), anchor='mm')
            total += 1
        if p > 0.55:
            a = int(255 * ease_out(clamp01((p - 0.55) / 0.3)))
            d.text((W / 2, 712), f'{total} 个号 × bond  →  攻击成本线性增长，且必须实付',
                   font=font(F_BOLD, 40), fill=RED + (a,), anchor='mm')

    # ---------------- 幕 2：成本可计算 ----------------
    else:
        a1 = ease_out(clamp01(p / 0.4))
        d.text((W / 2, 300), '攻击成本第一次变得可计算', font=font(F_BOLD, 60), fill=WHITE + (int(250 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.35) / 0.4))
        if a2 > 0:
            card(d, [400, 430, W - 400, 690], fill=(30, 26, 58, int(235 * a2)), outline=AMBER + (int(180 * a2),), r=18)
            d.text((W / 2, 480), '攻击 N 个号的成本', font=font(F_BOLD, 30),
                   fill=WHITE + (int(240 * a2),), anchor='mm')
            d.text((W / 2, 552), '=  N × bond  +  N × gas', font=font(F_MONO, 40),
                   fill=AMBER + (int(245 * a2),), anchor='mm')
            d.text((W / 2, 636), '而且每一个号：要么走完揭示退款，要么亏掉押金',
                   font=font(F_REG, 27), fill=WHITE + (int(228 * a2),), anchor='mm')
        a3 = ease_out(clamp01((p - 0.72) / 0.28))
        d.text((W / 2, 720), '要付出真金白银', font=font(F_SER, 56), fill=GREEN + (int(250 * a3),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')

# ============================================================
# S4 · 第二层：质押加权抽签
# ============================================================
def s4(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S4_CUTS)
    local = t - S4_CUTS[i] * dur
    span = (S4_CUTS[i + 1] - S4_CUTS[i]) * dur if i + 1 < len(S4_CUTS) else dur - S4_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    # ---------------- 幕 0：权重正比于质押 ----------------
    if i == 0:
        header(img, d, '第二层防御 · 质押加权抽签', '防御 2/2 · 女巫中性')
        d.text((96, 175), '中签权重 ∝ 质押额，与「你有多少个地址」无关',
               font=font(F_BOLD, 32), fill=ACCENT2 + (235,), anchor='la')
        # 数轴：权重累积
        x0, x1 = 200, W - 200
        y = 420
        reveal = ease_out(clamp01(p / 0.5))
        # 三名参与者
        parts = [('诚实用户 A', 0.50, GREEN), ('大玩家 B', 0.30, ACCENT), ('小号组 C', 0.20, AMBER)]
        acc = 0.0
        for name, wgt, col in parts:
            seg = (x1 - x0) * wgt * reveal
            sx = x0 + (x1 - x0) * acc
            if seg > 10:
                d.rounded_rectangle([sx + 2, y - 46, sx + max(seg - 2, 4), y + 46], radius=8, fill=col + (205,))
                if seg > 150:
                    d.text((sx + seg / 2, y), name, font=font(F_BOLD, 26), fill=(12, 10, 26, 240), anchor='mm')
                    d.text((sx + seg / 2, y + 78), f'{int(wgt * 100)}% 权重', font=font(F_BOLD, 23),
                           fill=col + (230,), anchor='mm')
            acc += wgt * reveal
        d.line([(x0, y - 70), (x0, y + 70)], fill=GREY + (180,), width=2)
        d.line([(x0 + (x1 - x0) * acc, y - 70), (x0 + (x1 - x0) * acc, y + 70)], fill=GREY + (180,), width=2)
        d.text((x0, y - 92), '0', font=font(F_MONO_R, 20), fill=GREY + (200,), anchor='mb')
        d.text((x0 + (x1 - x0) * acc, y - 92), 'totalWeight（总权重）', font=font(F_BOLD, 21),
               fill=GREY + (200,), anchor='mb')
        # 算法步骤
        if p > 0.45:
            a = int(255 * ease_out(clamp01((p - 0.45) / 0.35)))
            # 中文标签与等宽公式分开绘制，避免方块
            steps = [('①  总权重', 'totalWeight = Σ stake'),
                     ('②  掷一次', 'x = seed mod totalWeight'),
                     ('③  判定中签', 'x → owner of that interval'),
                     ('④  无放回', 'winner.weight = 0, repeat k')]
            for k, (cn, code) in enumerate(steps):
                aa = max(0, a - min(k, 2) * 12)
                yy = 596 + k * 54
                d.text((200, yy), cn, font=font(F_BOLD, 25), fill=ACCENT2 + (aa,), anchor='la')
                d.text((370, yy), code, font=font(F_MONO, 24), fill=GREY + (aa,), anchor='la')

    # ---------------- 幕 1：掷点动画 ----------------
    elif i == 1:
        header(img, d, '无放回累积权重采样', '防御 2/2 · 一次抽签全过程')
        x0, x1 = 180, 1020
        y = 470
        parts = [('A', 0.5, GREEN), ('B', 0.3, ACCENT), ('C', 0.2, AMBER)]
        acc = 0.0
        for name, wgt, col in parts:
            seg = (x1 - x0) * wgt
            sx = x0 + (x1 - x0) * acc
            if seg > 10:
                d.rounded_rectangle([sx + 2, y - 50, sx + max(seg - 2, 4), y + 50], radius=8, fill=col + (200,))
            d.text((sx + seg / 2, y), name, font=font(F_BOLD, 34), fill=(12, 10, 26, 240), anchor='mm')
            acc += wgt
        # 指针：落点固定在 A 的区间内（0.5 之前），与下方文案严格一致
        rng = random.Random(42)
        target = 0.12 + rng.random() * 0.30      # 0.12 ~ 0.42，必然落在 A
        ptr = ease_in_out(clamp01(p / 0.65)) * target
        hit = 'A' if target < 0.5 else ('B' if target < 0.8 else 'C')
        px = x0 + (x1 - x0) * ptr
        d.polygon([(px, y - 64), (px - 14, y - 92), (px + 14, y - 92)], fill=AMBER + (245,))
        d.line([(px, y - 92), (px, y + 60)], fill=AMBER + (200,), width=3)
        # 命中判定
        if p > 0.62:
            a = int(255 * ease_out(clamp01((p - 0.62) / 0.25)))
            # 公式用等宽字体，中文结论用粗体，分开绘制避免方块
            d.text((x0 + 6, y + 128), f'x = {target:.3f} x totalWeight', font=font(F_MONO, 28),
                   fill=GREEN + (a,), anchor='lm')
            d.text((x0 + 420, y + 128), f'→  落入 {hit} 的权重区间', font=font(F_BOLD, 30),
                   fill=GREEN + (a,), anchor='lm')
            d.text((x0 + 6, y + 192), f'{hit} 中签 → 权重清零 → 下一轮不再参与',
                   font=font(F_BOLD, 32), fill=WHITE + (a,), anchor='lm')
        # 右侧说明
        notes = ['无放回：已中签者剔除', '权重正比质押：公平可验证', 'seed 来自链上区块字段']
        for k, nt in enumerate(notes):
            aa = int(220 * clamp01(p * 3 - k * 0.7))
            d.text((x1 + 90, 420 + k * 76), '· ' + nt, font=font(F_REG, 28), fill=ACCENT2 + (aa,), anchor='la')

    # ---------------- 幕 2：女巫中性 ----------------
    elif i == 2:
        header(img, d, '关键性质：女巫中性（splitting gains nothing）', '防御 2/2 · 拆号不增权')
        # 上：1 个地址 1.0
        a1 = ease_out(clamp01(p / 0.4))
        d.text((160, 260), '场景一：', font=font(F_BOLD, 30), fill=GREY + (int(230 * a1),), anchor='la')
        d.rounded_rectangle([360, 218, 1160, 288], radius=10, fill=GREEN + (int(210 * a1),))
        d.text((760, 253), '1 个地址 · 押 1.0', font=font(F_BOLD, 32), fill=(12, 10, 26, int(245 * a1)), anchor='mm')
        d.text((1200, 253), '1.0', font=font(F_MONO, 34), fill=GREEN + (int(240 * a1),), anchor='lm')
        d.text((1270, 253), '权重', font=font(F_BOLD, 26), fill=GREEN + (int(240 * a1),), anchor='lm')
        # 下：5 个地址各 0.2
        a2 = ease_out(clamp01((p - 0.35) / 0.45))
        d.text((160, 470), '场景二：', font=font(F_BOLD, 30), fill=GREY + (int(230 * a2),), anchor='la')
        segw = (1160 - 360) / 5
        for k in range(5):
            if a2 <= 0.01: break
            aa = int(210 * clamp01(a2 * 1.4 - k * 0.12))
            d.rounded_rectangle([360 + k * segw + 3, 428, 360 + (k + 1) * segw - 3, 498], radius=8,
                                fill=AMBER + (aa,))
            d.text((360 + k * segw + segw / 2, 463), f'0.2', font=font(F_MONO, 24),
                   fill=(12, 10, 26, int(240 * aa / 255)), anchor='mm')
        d.text((1200, 463), '1.0', font=font(F_MONO, 34), fill=AMBER + (int(240 * a2),), anchor='lm')
        d.text((1270, 463), '权重', font=font(F_BOLD, 26), fill=AMBER + (int(240 * a2),), anchor='lm')
        # 等号 + 印章
        if p > 0.62:
            a3 = int(255 * ease_out(clamp01((p - 0.62) / 0.28)))
            d.text((300, 380), '=', font=font(F_BOLD, 60), fill=WHITE + (a3,), anchor='mm')
            # 印章
            cx, cy = W / 2, 690
            d.rounded_rectangle([cx - 460, cy - 62, cx + 460, cy + 62], radius=16,
                                fill=(20, 50, 40, int(210 * a3 / 255)), outline=GREEN + (a3,), width=3)
            d.text((cx, cy), '总权重完全相等 → 拆号一分钱便宜都占不到',
                   font=font(F_BOLD, 38), fill=GREEN + (a3,), anchor='mm')
            d.text((cx, cy + 108), '这就是女巫中性：拆分不改变任何人的中签概率',
                   font=font(F_REG, 30), fill=GREY + (a3,), anchor='mm')

    # ---------------- 幕 3：模式开关 ----------------
    else:
        a1 = ease_out(clamp01(p / 0.4))
        d.text((W / 2, 250), '等概率模式我们保留着', font=font(F_BOLD, 52), fill=WHITE + (int(250 * a1),), anchor='mm')
        d.text((W / 2, 330), '一个开关控制（weighted）', font=font(F_REG, 32), fill=GREY + (int(230 * a1),), anchor='mm')
        # 两栏对比
        a2 = ease_out(clamp01((p - 0.3) / 0.4))
        card(d, [200, 430, 940, 720], fill=(24, 40, 34, int(225 * a2)), outline=GREEN + (int(160 * a2),), r=20)
        d.text((570, 495), '加权模式  weighted = true', font=font(F_BOLD, 32), fill=GREEN + (int(245 * a2),), anchor='mm')
        d.text((570, 570), '高价值发售', font=font(F_BOLD, 40), fill=WHITE + (int(245 * a2),), anchor='mm')
        d.text((570, 640), '按质押加权，抑制全职黄牛', font=font(F_REG, 26), fill=GREY + (int(230 * a2),), anchor='mm')
        card(d, [980, 430, W - 200, 720], fill=(30, 30, 60, int(225 * a2)), outline=ACCENT + (int(160 * a2),), r=20)
        d.text((1350, 495), '等概率模式  weighted = false', font=font(F_BOLD, 32), fill=ACCENT2 + (int(245 * a2),), anchor='mm')
        d.text((1350, 570), '社区活动', font=font(F_BOLD, 40), fill=WHITE + (int(245 * a2),), anchor='mm')
        d.text((1350, 640), '人人同权，一人一票', font=font(F_REG, 26), fill=GREY + (int(230 * a2),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')

# ============================================================
# S5 · 验证：71 项断言，195 笔真实交易
# ============================================================
def s5(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S5_CUTS)
    local = t - S5_CUTS[i] * dur
    span = (S5_CUTS[i + 1] - S5_CUTS[i]) * dur if i + 1 < len(S5_CUTS) else dur - S5_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    # ---------------- 幕 0：四个大数字 ----------------
    if i == 0:
        header(img, d, '验证：不是幻灯片上的承诺', '验证 · Monad 测试网真实上链')
        nums = [('71', '项断言通过', GREEN), ('195', '笔真实交易', ACCENT2),
                ('0', '项失败', GREEN), ('416', '秒跑完', AMBER)]
        for k, (val, label, col) in enumerate(nums):
            prog = clamp01(p * 4.2 - k * 0.55)
            if prog <= 0.01: continue
            a = int(255 * ease_out(prog))
            x = 150 + k * 425
            # 数字滚动
            cur = int(int(val) * ease_out(prog))
            d.text((x, 400), f'{cur}', font=font(F_BOLD, 130), fill=col + (a,), anchor='lm')
            d.text((x + 8, 500), label, font=font(F_BOLD, 32), fill=GREY + (a,), anchor='lm')
        if p > 0.72:
            a2 = int(255 * ease_out(clamp01((p - 0.72) / 0.28)))
            d.text((W / 2, 640), '全部通过  ✓', font=font(F_BOLD, 54), fill=GREEN + (a2,), anchor='mm')
            d.text((W / 2 - 130, 715), '合约地址', font=font(F_BOLD, 25), fill=GREY + (a2,), anchor='rm')
            d.text((W / 2 - 110, 715), '0xA908…84A  ·  Monad testnet 10143',
                   font=font(F_MONO, 25), fill=GREY + (a2,), anchor='lm')

    # ---------------- 幕 1：对照柱状图 ----------------
    elif i == 1:
        header(img, d, '同规模对手 · 两种模式对照', '验证 · 女巫中性成立')
        base_y = 780
        # 左：等概率
        a1 = ease_out(clamp01(p / 0.4))
        d.text((480, 220), '等概率模式', font=font(F_BOLD, 40), fill=ACCENT2 + (int(245 * a1),), anchor='mm')
        d.text((480, 276), '攻击方 vs 诚实', font=font(F_REG, 26), fill=GREY + (int(225 * a1),), anchor='mm')
        h_att = 380 * ease_out(clamp01((p - 0.15) / 0.4))
        h_hon = 380 * 0.5 * ease_out(clamp01((p - 0.25) / 0.4))
        if h_att > 2: d.rounded_rectangle([340, base_y - h_att, 450, base_y], radius=8, fill=RED + (int(215 * a1),))
        if h_hon > 2: d.rounded_rectangle([510, base_y - h_hon, 620, base_y], radius=8, fill=GREEN + (int(215 * a1),))
        d.text((395, base_y - h_att - 30), '4', font=font(F_BOLD, 36), fill=RED + (int(240 * a1),), anchor='mm')
        d.text((565, base_y - h_hon - 30), '2', font=font(F_BOLD, 36), fill=GREEN + (int(240 * a1),), anchor='mm')
        d.line([(280, base_y + 4), (680, base_y + 4)], fill=LINE + (int(200 * a1),), width=2)
        d.text((480, base_y + 46), '攻击方占优  ← 漏洞', font=font(F_BOLD, 28), fill=RED + (int(235 * a1),), anchor='mm')

        # 分隔线
        d.line([(W / 2, 200), (W / 2, 850)], fill=LINE + (int(140 * a1),), width=2)

        # 右：加权
        a2 = ease_out(clamp01((p - 0.4) / 0.4))
        d.text((1440, 220), '加权模式', font=font(F_BOLD, 40), fill=GREEN + (int(245 * a2),), anchor='mm')
        d.text((1440, 276), '5 小号 vs 1 地址（权重相等）', font=font(F_REG, 26), fill=GREY + (int(225 * a2),), anchor='mm')
        h_a2 = 380 * 0.5 * ease_out(clamp01((p - 0.5) / 0.4))
        h_h2 = 380 * 0.68 * ease_out(clamp01((p - 0.55) / 0.4))
        if h_a2 > 2: d.rounded_rectangle([1300, base_y - h_a2, 1410, base_y], radius=8, fill=RED + (int(190 * a2),))
        if h_h2 > 2: d.rounded_rectangle([1470, base_y - h_h2, 1580, base_y], radius=8, fill=GREEN + (int(215 * a2),))
        d.text((1355, base_y - h_a2 - 30), '2', font=font(F_BOLD, 36), fill=RED + (int(240 * a2),), anchor='mm')
        d.text((1525, base_y - h_h2 - 30), '4', font=font(F_BOLD, 36), fill=GREEN + (int(240 * a2),), anchor='mm')
        d.line([(1240, base_y + 4), (1640, base_y + 4)], fill=LINE + (int(200 * a2),), width=2)
        if p > 0.8:
            a3 = int(255 * ease_out(clamp01((p - 0.8) / 0.2)))
            d.text((1440, base_y + 46), '回归接近 50/50  ← 拆号失效', font=font(F_BOLD, 28),
                   fill=GREEN + (a3,), anchor='mm')
        d.text((W / 2, 706), '权重相等时，地址数量不再是优势',
               font=font(F_BOLD, 34), fill=WHITE + (int(230 * clamp01((p - 0.75) / 0.25)),), anchor='mm')

    # ---------------- 幕 2：非法路径全部正确回退 ----------------
    elif i == 2:
        header(img, d, '非法路径：全部正确回退（revert）', '验证 · 边界与攻击面')
        cases = [('重复提交', 'one order per address'), ('金额不足', 'underpaid'),
                 ('等概率超额质押', 'wrong price'), ('窗口未开就揭示', 'commit still open'),
                 ('错误密钥', 'bad secret'), ('重复揭示', 'already revealed'),
                 ('非提交者揭示', 'not committed'), ('窗口未关就开奖', 'reveal still open'),
                 ('重复退款', 'already refunded'), ('中签者退款', 'you won, no refund'),
                 ('越权提款', 'issuer only'), ('重复提款（无款可提）', 'nothing to sweep')]
        for k, (cn, en) in enumerate(cases):
            prog = clamp01(p * 5.2 - k * 0.34)
            if prog <= 0.01: continue
            a = int(255 * ease_out(prog))
            col_k = k % 2
            row = k // 2
            x = 130 + col_k * 848
            y = 190 + row * 108
            d.rounded_rectangle([x, y, x + 800, y + 92], radius=12,
                                fill=(24, 38, 32, int(195 * a / 255)), outline=GREEN + (int(130 * a / 255),), width=2)
            d.text((x + 24, y + 14), 'OK', font=font(F_MONO, 26), fill=GREEN + (a,), anchor='la')
            d.text((x + 82, y + 12), cn, font=font(F_BOLD, 27), fill=WHITE + (a,), anchor='la')
            d.text((x + 82, y + 52), f'revert: "{en}"', font=font(F_MONO_R, 19), fill=GREY + (a,), anchor='la')
        if p > 0.82:
            a2 = int(255 * ease_out(clamp01((p - 0.82) / 0.18)))
            d.text((W / 2, 862), '该拦的全都拦住了 · 且账目逐 wei 对平',
                   font=font(F_BOLD, 40), fill=GREEN + (a2,), anchor='mm')

    # ---------------- 幕 3：账目对平 ----------------
    else:
        header(img, d, '账目：逐 wei 对平', '验证 · 资金守恒')
        a1 = ease_out(clamp01(p / 0.35))
        # 天平
        cx, cy = W / 2, 420
        d.line([(cx - 400, cy + 190), (cx + 400, cy + 190)], fill=LINE + (int(200 * a1),), width=3)
        d.polygon([(cx, cy - 10), (cx - 250, cy + 150), (cx + 250, cy + 150)], fill=(35, 30, 70, int(220 * a1)))
        # 左盘：流入
        d.text((cx - 250, cy + 60), 'Σ 流入', font=font(F_BOLD, 34), fill=GREEN + (int(245 * a1),), anchor='mm')
        d.text((cx - 250, cy + 108), '质押 + 保证金', font=font(F_REG, 24), fill=GREY + (int(225 * a1),), anchor='mm')
        # 右盘：流出
        d.text((cx + 250, cy + 60), 'Σ 流出', font=font(F_BOLD, 34), fill=AMBER + (int(245 * a1),), anchor='mm')
        d.text((cx + 250, cy + 108), '退款 + 提款', font=font(F_REG, 24), fill=GREY + (int(225 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.35) / 0.4))
        if a2 > 0.02:
            d.rounded_rectangle([cx - 470, 620, cx + 470, 720], radius=18,
                                fill=(24, 40, 34, int(220 * a2)), outline=GREEN + (int(190 * a2),), width=3)
            d.text((cx, 670), 'Σ 流入 − Σ 流出  =  合约余额',
                   font=font(F_MONO, 38), fill=GREEN + (int(250 * a2),), anchor='mm')
        a3 = ease_out(clamp01((p - 0.7) / 0.3))
        d.text((cx, 690), '每一场次也单独核对：未退质押 + 待提 proceeds 全部对齐',
               font=font(F_REG, 30), fill=GREY + (int(235 * a3),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')

# ============================================================
# S6 · 收尾
# ============================================================
def s6(t, dur, subs, d_cur):
    img = BG.copy().convert('RGBA')
    d = ImageDraw.Draw(img, 'RGBA')
    i = sub_index(t, dur, S6_CUTS)
    local = t - S6_CUTS[i] * dur
    span = (S6_CUTS[i + 1] - S6_CUTS[i]) * dur if i + 1 < len(S6_CUTS) else dur - S6_CUTS[i] * dur
    p = clamp01(local / max(span, 1e-6))

    if i == 0:
        # 三行对比
        rows = [('谁网快谁赢', '公开抽签', GREEN),
                ('谁号多谁赢', '谁押得多谁权重高', GREEN)]
        for k, (a, b, col) in enumerate(rows):
            prog = ease_out(clamp01(p * 2.4 - k * 0.7))
            if prog <= 0.01: continue
            aa = int(255 * prog)
            y = 300 + k * 170
            d.text((W / 2 - 320, y), a, font=font(F_BOLD, 46), fill=RED + (aa,), anchor='rm')
            # 箭头
            d.polygon([(W / 2 - 250, y), (W / 2 - 190, y), (W / 2 - 190, y - 20),
                       (W / 2 - 150, y), (W / 2 - 190, y + 20), (W / 2 - 190, y)],
                      fill=AMBER + (aa,))
            d.text((W / 2 + 40, y), b, font=font(F_BOLD, 46), fill=col + (aa,), anchor='lm')
        if p > 0.62:
            aa2 = int(255 * ease_out(clamp01((p - 0.62) / 0.3)))
            d.text((W / 2, 640), '一个人可以开五十个号', font=font(F_REG, 40), fill=GREY + (aa2,), anchor='mm')
            d.text((W / 2, 720), '但他再也没法用五十个号，打败五十个真实的人',
                   font=font(F_SER, 52), fill=WHITE + (aa2,), anchor='mm')
    else:
        a1 = ease_out(clamp01(p / 0.35))
        d.text((W / 2, 300), 'BlitzFair V2', font=font(F_BOLD, 96), fill=ACCENT2 + (int(255 * a1),), anchor='mm')
        a2 = ease_out(clamp01((p - 0.22) / 0.35))
        d.text((W / 2, 430), '让机器速度不再决定结果', font=font(F_SER, 56), fill=WHITE + (int(250 * a2),), anchor='mm')
        a3 = ease_out(clamp01((p - 0.42) / 0.35))
        d.text((W / 2, 520), '让地址数量不再等于人数', font=font(F_SER, 56), fill=GREEN + (int(250 * a3),), anchor='mm')
        a4 = ease_out(clamp01((p - 0.62) / 0.3))
        if a4 > 0.02:
            d.line([(W / 2 - 320, 600), (W / 2 + 320, 600)], fill=ACCENT + (int(180 * a4),), width=2)
            d.text((W / 2, 660), '合约  0xA90818C1c4557619De96BeEAb3E3A52BeC82B84A',
                   font=font(F_MONO_R, 26), fill=GREY + (int(235 * a4),), anchor='mm')
            d.text((W / 2, 710), 'Monad testnet 10143 · 71 项断言 / 195 笔交易 / 0 失败',
                   font=font(F_REG, 24), fill=GREY_D + (int(225 * a4),), anchor='mm')

    img = draw_subtitle(img, d_cur)
    return img.convert('RGB')
