#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把六幕拼成完整影片：配音时长驱动时间轴 → 渲染帧 → 合入音轨 + BGM"""

import os, sys, json, math, subprocess, re
import numpy as np
from PIL import Image
import imageio.v2 as imageio

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_core as R
from render_core import W, H, FPS, font, F_BOLD, F_REG, F_SER, F_MONO, F_MONO_R
import scenes as SC

VOICE = os.path.join(HERE, 'assets', 'voice-v2')
OUT = os.path.join(HERE, 'assets', 'blitzfair-v2-sybil.mp4')
TMP_AUDIO = '/tmp/v2_narration.wav'
BGM = '/tmp/video/bgm.wav'
FFMPEG = subprocess.check_output(['python3', '-c', 'import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())']).decode().strip()

# ---------------- 字幕（与旁白逐句对应） ----------------
SUBS = {
 's1': [
  (0.0,  5.6,  '假设有这么一个人。他不写机器人，也不抢网速。'),
  (5.6,  12.8, '他只是打开五十个钱包，每个钱包押一块钱，同时按下提交。'),
  (12.8, 19.2, '结果呢？五十张票，全是他的。'),
  (19.2, 25.6, '真正想要门票的那九个人，站在旁边，一张都没拿到。'),
  (25.6, 31.4, '这就是女巫攻击，Sybil Attack。'),
  (31.4, 37.9, '它不攻击代码，它攻击「一个地址 = 一个人」这个假设。'),
 ],
 's2': [
  (0.0,  4.2,  '我们用真实数据跑了一遍。'),
  (4.2,  12.6, '等概率抽签下，五个小号对上一个诚实地址，六个回合，攻击方赢了四回合。'),
  (12.6, 17.4, '不是运气。是数学。'),
  (17.4, 21.8, '地址数量直接兑换中签概率。'),
  (21.8, 27.6, '还有第二个洞：批量提交之后根本不去揭示，成本几乎为零。'),
  (27.6, 32.5, '白占名额，拉低别人的中签率，一分钱不花。'),
 ],
 's3': [
  (0.0,  5.0,  '第一层，保证金。'),
  (5.0,  10.4, '提交时必须随单押一笔保证金。'),
  (10.4, 15.4, '揭示，立即全额退回；不揭示，保证金没收，直接归发行方。'),
  (15.4, 21.2, '这一招把「免费占位」改成了「每单固定成本」。'),
  (21.2, 26.2, '你可以开一百个号，但每一个号要么走完流程，要么亏掉押金。'),
 ],
 's4': [
  (0.0,  4.6,  '第二层是核心。'),
  (4.6,  10.2, '我们把抽签从「等概率」换成「按质押加权」。'),
  (10.2, 16.4, '中签权重，正比于你押了多少，跟你有多少个地址完全无关。'),
  (16.4, 26.4, '算法是无放回的累积权重采样：算出总权重，掷一次，看落进谁的区间。'),
  (26.4, 32.4, '中签的人权重清零，再掷下一次。'),
  (32.4, 38.4, '把一块钱拆成五份、五个号，总权重还是一块钱。'),
  (38.4, 43.8, '拆得越碎，越没有便宜可占。这就是女巫中性。'),
 ],
 's5': [
  (0.0,  4.0,  '这些不是幻灯片上的承诺。'),
  (4.0,  8.4,  '我们在 Monad 测试网上跑了完整测试。'),
  (8.4,  15.4, '等概率模式，攻击方六局赢四局；'),
  (15.4, 21.8, '加权模式，四个回合对两个回合，谁也没能横扫。'),
  (21.8, 27.4, '一共七十一项断言、一百九十五笔真实上链交易、四分半跑完。'),
  (27.4, 32.4, '重复提交、错误密钥、越权提款、窗口外操作，全部正确回退。'),
  (32.4, 37.9, '账目也逐 wei 对平：资金流入减流出，等于合约余额。'),
 ],
 's6': [
  (0.0,  5.0,  '所以，BlitzFair V2 做的事很简单：'),
  (5.0,  11.4, '把「谁网快谁赢」换成「公开抽签」，'),
  (11.4, 17.4, '再把「谁号多谁赢」换成「谁押得多谁权重高」。'),
  (17.4, 21.4, '一个人可以开五十个号。'),
  (21.4, 26.9, '但他再也没法用五十个号，打败五十个真实的人。'),
 ],
}

# ---------------- 读取配音真实时长 ----------------
def dur_of(path):
    out = subprocess.run([FFMPEG, '-i', path], capture_output=True, text=True).stderr
    m = re.search(r'Duration: (\d+):(\d+):([\d.]+)', out)
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))

def subtitle_at(key, t):
    for (a, b, txt) in SUBS.get(key, []):
        if a <= t < b:
            # 淡入淡出
            fin = min(1.0, (t - a) / 0.18)
            fout = min(1.0, (b - t) / 0.18)
            return txt, clamp(min(fin, fout))
    return None, 0.0

clamp = lambda x: max(0.0, min(1.0, x))

SCENES = [('s1', SC.s1), ('s2', SC.s2), ('s3', SC.s3),
          ('s4', SC.s4), ('s5', SC.s5), ('s6', SC.s6)]
TAIL = 1.4   # 每幕后留白

def build_timeline():
    tl = []
    cursor = 0.0
    for key, fn in SCENES:
        d = dur_of(os.path.join(VOICE, key + '.mp3'))
        tl.append({'key': key, 'fn': fn, 'start': cursor, 'dur': d})
        cursor += d + TAIL
    return tl, cursor

def frame_at(tl, total, t):
    # 定位当前幕
    cur = tl[0]
    for s in tl:
        if t >= s['start']:
            cur = s
    local = t - cur['start']
    if local > cur['dur']:            # 幕后的留白：定格最后一帧
        local = cur['dur']
    txt, alpha = subtitle_at(cur['key'], min(local, cur['dur'] - 0.01))
    img = cur['fn'](local, cur['dur'], SUBS[cur['key']], txt if alpha > 0 else None)
    if txt and alpha <= 0:
        img = cur['fn'](local, cur['dur'], SUBS[cur['key']], None)
    # 重新叠加字幕（带淡入淡出 alpha）
    frames = img.convert('RGBA')
    if txt and alpha > 0.01:
        frames = R.draw_subtitle(frames, txt, alpha)
    # 页脚
    d = R.ImageDraw.Draw(frames, 'RGBA')
    idx = tl.index(cur) + 1
    R.footer(d, idx, len(tl), alpha=0.85)
    # 幕间淡入
    fade = 1.0
    if local < 0.5:
        fade = local / 0.5
    elif t > total - 0.9:
        fade = max(0.0, (total - t) / 0.9)
    if fade < 0.999:
        black = R.Image.new('RGBA', (W, H), (0, 0, 0, int(255 * (1 - fade))))
        frames = R.Image.alpha_composite(frames, black)
    return frames.convert('RGB')

def mix_audio(tl, total):
    """旁白轨 + BGM 垫底"""
    # 1) 生成旁白音轨（按时间轴放置）
    n_samples = int(total * 44100)
    narr = np.zeros(n_samples, dtype=np.float32)
    for s in tl:
        wav = '/tmp/_seg_%s.wav' % s['key']
        subprocess.run([FFMPEG, '-y', '-i', os.path.join(VOICE, s['key'] + '.mp3'),
                        '-ar', '44100', '-ac', '1', wav], capture_output=True)
        import wave
        with wave.open(wav) as w:
            data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        start = int(s['start'] * 44100)
        end = min(n_samples, start + len(data))
        narr[start:end] += data[:end - start]
    # 2) BGM：循环到全长，压到 -26dB 垫底
    import wave
    with wave.open(BGM) as w:
        sr = w.getframerate()
        bg = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        if w.getnchannels() == 2: bg = bg.reshape(-1, 2).mean(axis=1)
    reps = int(math.ceil(n_samples / len(bg)))
    bgm = np.tile(bg, reps)[:n_samples]
    # 首尾淡入淡出
    fl = int(2.0 * 44100)
    bgm[:fl] *= np.linspace(0, 1, fl)
    bgm[-fl:] *= np.linspace(1, 0, fl)
    bgm *= 0.055
    mix = narr * 1.0 + bgm
    peak = np.max(np.abs(mix))
    if peak > 0.96: mix *= 0.96 / peak
    out = (mix * 32767).astype(np.int16)
    with wave.open(TMP_AUDIO, 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(44100)
        w.writeframes(out.tobytes())
    return TMP_AUDIO

if __name__ == '__main__':
    only = sys.argv[1] if len(sys.argv) > 1 else None
    tl, total = build_timeline()
    print('时间轴：')
    for s in tl:
        print(f"  {s['key']}: {s['start']:6.2f}s → {s['start'] + s['dur']:6.2f}s  (时长 {s['dur']:.2f}s)")
    print(f'总时长 {total:.2f}s = {int(total // 60)}分{total % 60:.1f}秒')

    if only == 'audio':
        print(mix_audio(tl, total)); sys.exit(0)

    TOTAL = int(total * FPS)
    writer = imageio.get_writer(OUT, fps=FPS, codec='libx264', quality=8,
                                macro_block_size=None, ffmpeg_log_level='error',
                                pixelformat='yuv420p')
    for i in range(TOTAL):
        t = i / FPS
        writer.append_data(np.asarray(frame_at(tl, total, t)))
        if i % 150 == 0:
            print(f'  frame {i}/{TOTAL}  ({t:.1f}s)', flush=True)
    writer.close()
    print('视频写出:', OUT)

    # 合入音轨
    audio = mix_audio(tl, total)
    final = OUT.replace('.mp4', '-final.mp4')
    subprocess.run([FFMPEG, '-y', '-i', OUT, '-i', audio, '-c:v', 'copy', '-c:a', 'aac',
                    '-b:a', '160k', '-shortest', '-movflags', '+faststart', final],
                   capture_output=True)
    os.replace(final, OUT)
    print('完成:', OUT)
