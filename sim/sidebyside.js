#!/usr/bin/env node
/**
 * 同屏双轮对比：同一批订单，左边「先到先得」，右边「commit-reveal 公开抽签」。
 *
 *   node sim/sidebyside.js                 # 默认 60 个脚本 + 44 个普通用户，10 个名额
 *   node sim/sidebyside.js --all 100 --quota 10
 *
 * 用途：三秒内让人看懂"换掉的到底是什么规则"。
 * 说明：本地 PRNG 复现合约的部分 Fisher–Yates 抽签；链上用区块字段作种子。
 */
'use strict';
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const SCRIPTS = parseInt(opt('scripts', '60'), 10);
const USERS = parseInt(opt('users', '44'), 10);
const QUOTA = parseInt(opt('quota', '10'), 10);
const SEED = parseInt(opt('seed', '42'), 10);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);

// 同一批订单：脚本下单极快（毫秒级），普通用户分散在几秒内
const orders = [];
for (let i = 0; i < SCRIPTS; i++) orders.push({ id: `script_${String(i + 1).padStart(3, '0')}`, script: true, t: 0.0004 + rand() * 0.008 });
for (let i = 0; i < USERS; i++) orders.push({ id: `user_${String(i + 1).padStart(3, '0')}`, script: false, t: 0.02 + rand() * 4 });
orders.sort((a, b) => a.t - b.t);
const total = orders.length;

// 左：先到先得 = 按时间戳取前 QUOTA 个
const fifo = orders.slice(0, QUOTA);

// 右：commit-reveal + Fisher–Yates，与订单时间无关
const pool = orders.slice();
for (let i = 0; i < QUOTA && i < pool.length; i++) {
  const j = i + Math.floor(rand() * (pool.length - i));
  [pool[i], pool[j]] = [pool[j], pool[i]];
}
const lottery = pool.slice(0, Math.min(QUOTA, pool.length));

const count = (list) => list.filter((x) => !x.script).length;
const fh = count(fifo), lh = count(lottery);
const p = total ? (QUOTA / total * 100).toFixed(1) : '0';

const C = { r: '\x1b[31m', g: '\x1b[32m', y: '\x1b[33m', b: '\x1b[1m', d: '\x1b[2m', m: '\x1b[35m', x: '\x1b[0m' };
const bar = (n, q, color) => `${color}${'█'.repeat(n)}${C.d}${'░'.repeat(Math.max(0, q - n))}${C.x}`;

console.log(`\n${C.b}同一批 ${total} 个订单（脚本 ${SCRIPTS} · 普通用户 ${USERS}）· 名额 ${QUOTA}${C.x}`);
console.log(`${C.d}唯一区别：左边按时间戳取前 ${QUOTA} 个，右边不看时间、公开抽签${C.x}\n`);

const rows = Math.max(QUOTA, 1);
for (let i = 0; i < rows; i++) {
  const L = fifo[i];
  const R = lottery[i];
  const fmt = (o) => (o ? `${o.script ? C.r : C.g}${o.id.padEnd(12)}${C.x}` : ' '.repeat(12));
  console.log(`  #${String(i + 1).padStart(2)}   ${fmt(L)}   │   ${fmt(R)}`);
}

console.log(`\n  ${C.b}${'先到先得'.padEnd(14)}${C.x} │ ${C.b}公开抽签${C.x}`);
console.log(`  普通用户中 ${C.b}${fh}${C.x}/${QUOTA}  ${bar(fh, QUOTA, C.g)}   │   普通用户中 ${C.b}${lh}${C.x}/${QUOTA}  ${bar(lh, QUOTA, C.g)}`);
console.log(`  脚本中     ${C.r}${QUOTA - fh}${C.x}/${QUOTA}  ${bar(QUOTA - fh, QUOTA, C.r)}   │   脚本中     ${C.y}${QUOTA - lh}${C.x}/${QUOTA}  ${bar(QUOTA - lh, QUOTA, C.y)}`);
console.log(`\n  ${C.d}抽签下每个订单中签概率相同：${p}%（${QUOTA}/${total}），与下单先后无关${C.x}`);
console.log(`  ${C.d}注意：抽签只消除"速度优势"。多开地址仍按比例中签——见 sybil-sim.js${C.x}\n`);
