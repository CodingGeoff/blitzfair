#!/usr/bin/env node
/**
 * 女巫攻击模拟：把"一地址一单 + 足额托管"能防什么、不能防什么，摆在同一张表上。
 *
 *   node sim/sybil-sim.js                          # 默认：1 个名额、票面 0.01 MON，对比不同地址数
 *   node sim/sybil-sim.js --quota 10 --price 0.01 --rounds 2000
 *
 * 输出三张表：
 *   1) 中签率随地址数变化（真人在 1 个地址下单的情况下）
 *   2) 攻击者的资金占用与期望收益
 *   3) 在"按场次热度动态提高押金"下的同一组数字（缓解方案，不是根治）
 *
 * 这不是安全证明，是把已知边界的数量级说清楚。
 */
'use strict';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const QUOTA = parseInt(opt('quota', '1'), 10);
const PRICE = parseFloat(opt('price', '0.01'));
const ROUNDS = parseInt(opt('rounds', '2000'), 10);
const RESALE = parseFloat(opt('resale', '3')); // 二级市场溢价倍数，用于算"货物价值"

const C = { b: '\x1b[1m', d: '\x1b[2m', r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', x: '\x1b[0m' };
const pct = (x) => (x * 100).toFixed(1).padStart(5) + '%';
const pad = (s, n) => String(s).padEnd(n);

/** 地址数 a 的期望收益：每个地址中签概率 = quota/(quota+a)，中签价值 = PRICE*RESALE */
function expected({ quota, addresses, price, resale }) {
  const p = Math.min(1, quota / (quota + addresses));
  const expectedWins = addresses * p;
  const cost = addresses * price;            // 资金占用（未中签会退回，但需要先备足）
  const gross = expectedWins * price * resale;
  return { p, expectedWins, cost, gross, profit: gross - expectedWins * price, roi: (gross - expectedWins * price) / cost };
}

const M = { b: C.b, d: C.d, r: C.r, g: C.g, y: C.y, x: C.x };
const line = (n) => '─'.repeat(n);

console.log(`\n${M.b}场景${M.x}：${QUOTA} 个名额 · 票面 ${PRICE} MON · 二级市场按 ${RESALE}× 计 · 真人有 1 个地址`);
console.log(`${M.d}假设攻击者每个地址只买 1 份、未中签全额退回；收益 = 中签份数 × 溢价${M.x}`);

// ---------- 表 1 ----------
console.log(`\n${M.b}表 1 · 攻击者地址数 → 中签率与资金占用${M.x}`);
console.log(`${line(66)}`);
console.log(`${pad('攻击者地址数', 14)}${pad('单址中签率', 12)}${pad('期望中签份数', 14)}${pad('需备资金(MON)', 15)}`);
console.log(`${line(66)}`);
for (const a of [1, 5, 10, 50, 100, 500]) {
  const r = expected({ quota: QUOTA, addresses: a, price: PRICE, resale: RESALE });
  console.log(`${pad(a, 14)}${pad(pct(r.p), 12)}${pad(r.expectedWins.toFixed(2), 14)}${pad(r.cost.toFixed(2), 15)}`);
}

// ---------- 表 2 ----------
console.log(`\n${M.b}表 2 · 同一组地址数下的收益测算${M.x}`);
console.log(`${line(74)}`);
console.log(`${pad('地址数', 10)}${pad('期望毛利', 14)}${pad('净收益', 14)}${pad('净收益率', 14)}${pad('真人中签率', 14)}`);
console.log(`${line(74)}`);
for (const a of [1, 10, 50, 100, 500]) {
  const r = expected({ quota: QUOTA, addresses: a, price: PRICE, resale: RESALE });
  const human = Math.min(1, QUOTA / (QUOTA + a)); // 真人只有 1 个地址
  console.log(`${pad(a, 10)}${pad(r.gross.toFixed(3), 14)}${pad(r.profit.toFixed(3), 14)}${pad(pct(r.roi), 14)}${pad(pct(human), 14)}`);
}

// ---------- 表 3 ----------
console.log(`\n${M.b}表 3 · 若按"场次热度"动态提高押金，攻击者成本如何变化${M.x}`);
console.log(`${M.d}押金倍数 = 申报地址数 / 名额（不超过上限）。它抬高成本，但不改变"多地址按比例中签"这个事实。${M.x}`);
console.log(`${line(74)}`);
console.log(`${pad('地址数', 10)}${pad('押金倍数', 12)}${pad('需备资金(MON)', 16)}${pad('净收益', 14)}${pad('结论', 18)}`);
console.log(`${line(74)}`);
for (const a of [1, 10, 50, 100, 500]) {
  const mult = Math.min(10, Math.max(1, a / QUOTA));
  const r = expected({ quota: QUOTA, addresses: a, price: PRICE * mult, resale: RESALE });
  const note = r.profit > 0 ? (mult >= 10 ? '成本显著上升' : '仍有利可图') : '打到负收益';
  console.log(`${pad(a, 10)}${pad(mult.toFixed(1) + '×', 12)}${pad((a * PRICE * mult).toFixed(2), 16)}${pad(r.profit.toFixed(3), 14)}${pad(note, 18)}`);
}

console.log(`\n${M.b}结论（照着这张表讲，不要说过头）${M.x}`);
console.log(`  · 抽签消除的是${M.g}速度优势${M.x}：脚本再快也只能拿到和普通用户相同的单址概率。`);
console.log(`  · 它${M.r}不消除资金优势${M.x}：地址数翻 100 倍，期望中签份数也接近翻 100 倍，代价是要先备足 100 份押金。`);
console.log(`  · 所以对外只说"把速度竞赛换成公开抽签"，${M.b}不要说"杜绝黄牛"${M.x}。`);
console.log(`  · 真正的缓解是三层叠加：一地址一单 + 动态押金 + 身份/白名单（发行方可控），三层都在合约之外或可插拔。\n`);
