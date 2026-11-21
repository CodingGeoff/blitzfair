#!/usr/bin/env node
/**
 * BlitzFair · 公平秒杀模拟器（现场大屏 / 演示用）
 *
 * 用法：
 *   node sim/simulate.js            # 完整演示（带延迟，约 25 秒）
 *   node sim/simulate.js --fast     # 跳过延迟
 *   node sim/simulate.js --scripts 60 --users 44 --quota 10 --seed 7
 *
 * 说明：本模拟在本地用 PRNG 复现合约的
 *   「时间戳排序（先到先得）」vs「commit-reveal + 部分 Fisher–Yates 抽签」
 * 对比逻辑；链上版本用 prevrandao ⊕ blockhash 作为 seed。
 * 参与者用「抢购脚本」与「普通用户」两类角色建模，不针对任何具体平台或个人。
 */
'use strict';

// ---------- 参数 ----------
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? def : args[i + 1];
};
const FAST   = args.includes('--fast');
const BOTS   = parseInt(opt('scripts', opt('bots', '60')), 10);
const HUMANS = parseInt(opt('users', opt('humans', '44')), 10);
const QUOTA  = parseInt(opt('quota', '10'), 10);
const SEED   = parseInt(opt('seed', '42'), 10);

// ---------- 确定性 PRNG（mulberry32）----------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const sleep = (ms) => new Promise(r => setTimeout(r, FAST ? 0 : ms));
const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  magenta: '\x1b[35m', cyan: '\x1b[36m', gray: '\x1b[90m',
};
const bar = (n, total, w = 30) => '█'.repeat(Math.round(w * n / total)).padEnd(w, '░');

// ---------- 造参与者 ----------
const participants = [];
for (let i = 0; i < BOTS; i++)   participants.push({ name: `script_${String(i).padStart(3, '0')}`, isBot: true,  ts: 0.0005 + rand() * 0.01 });
for (let i = 0; i < HUMANS; i++) participants.push({ name: `user_${String(i).padStart(2, '0')}`, isBot: false, ts: 0.02   + rand() * 4.0  });

// ---------- 第 1 轮：传统先到先得 ----------
async function roundFIFO() {
  console.log(`${C.bold}${C.gray}┌─ 第 1 轮 · 传统「先到先得」（按订单时间戳排序）${C.reset}`);
  const sorted = [...participants].sort((a, b) => a.ts - b.ts);
  const winners = sorted.slice(0, QUOTA);
  for (let i = 0; i < QUOTA; i++) {
    const p = winners[i];
    console.log(`   ${C.gray}t+${p.ts.toFixed(4)}s${C.reset}  第${i + 1} 名  ${p.isBot ? C.red : C.green}${p.name}${C.reset}`);
    await sleep(120);
  }
  const h = winners.filter(w => !w.isBot).length;
  console.log(`   ${C.bold}中签：脚本 ${QUOTA - h}/${QUOTA}    用户 ${h}/${QUOTA}${C.reset}`);
  console.log(`   ${C.red}${bar(QUOTA - h, QUOTA)}${C.reset} ← 名额被脚本占满`);
  console.log(`   公平吗？—— 谁 gas 出得起、谁离节点近，谁赢。普通用户没有机会。\n`);
  return winners;
}

// ---------- 第 2 轮：BlitzFair（commit-reveal + 单块抽签）----------
async function roundBlitzFair() {
  console.log(`${C.bold}${C.magenta}┌─ 第 2 轮 · BlitzFair（commit → reveal → 单块抽签）${C.reset}`);
  console.log(`   ${C.cyan}🔒 提交阶段${C.reset}：所有人只交 hash，没人知道别人下了什么单（防抢跑/防抄单）`);
  await sleep(600);
  console.log(`   ${C.cyan}🔓 揭示阶段${C.reset}：${participants.length} 人全部 reveal，进入候选池`);
  await sleep(600);
  const seedHex = '0x' + [...Array(8)].map(() => Math.floor(rand() * 256).toString(16).padStart(2, '0')).join('') + '…';
  console.log(`   ${C.yellow}🎲 链上 seed = ${seedHex}  (prevrandao ⊕ blockhash)${C.reset}`);
  await sleep(300);
  for (let i = 0; i <= 10; i++) {
    process.stdout.write(`\r   开奖中 ${bar(i, 10)} ${i * 10}%`);
    await sleep(FAST ? 0 : 90);
  }
  console.log();

  // 与合约一致的部分 Fisher–Yates
  const pool = [...participants];
  for (let i = 0; i < QUOTA; i++) {
    const j = i + Math.floor(rand() * (pool.length - i));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const winners = pool.slice(0, QUOTA);
  const humansWon = winners.filter(w => !w.isBot).length;
  const botsWon = QUOTA - humansWon;
  const humanRate = (QUOTA / participants.length * 100).toFixed(1);

  console.log(`   ${C.bold}🏆 中签名单：${C.reset}`);
  winners.forEach((w, i) => {
    console.log(`   ${i + 1}. ${w.isBot ? C.red : C.green}${w.name}${C.reset}`);
  });
  console.log();
  console.log(`   ${C.green}用户中签 ${humansWon}/${QUOTA}${C.reset}  ·  脚本中签 ${botsWon}/${QUOTA}  ·  每个人中签概率都是 ${humanRate}%`);
  console.log(`   ${C.bold}没人能用速度、gas 或脚本抢跑——只看运气，人人平等。${C.reset}`);
  console.log(`   ${C.dim}未中签者：调用 claimRefund 即可全额原路退回。${C.reset}\n`);
  return winners;
}

// ---------- 主流程 ----------
(async () => {
  console.log(`\n${C.bold}${C.magenta}`);
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║   ⚡ BlitzFair · 链上公平秒杀 · 现场模拟         ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`${C.reset}`);
  console.log(`${C.bold}场景：演唱会门票 · 限量 ${QUOTA} 张${C.reset}`);
  console.log(`${HUMANS} 个普通用户 · ${BOTS} 个抢购脚本 · 每人限购 1 份（一地址一单）\n`);
  await sleep(800);

  const fifo = await roundFIFO();
  await sleep(700);
  const fair = await roundBlitzFair();

  const fifoHumans = fifo.filter(w => !w.isBot).length;
  const fairHumans = fair.filter(w => !w.isBot).length;
  console.log(`${C.bold}${C.yellow}━━━ 总结 ━━━${C.reset}`);
  console.log(`先到先得 → 普通用户中 ${fifoHumans} 份   vs   BlitzFair → 普通用户中 ${fairHumans} 份`);
  console.log(`${C.dim}（先到先得 = 0 公平；BlitzFair = 人人等概率，无人能抢跑）${C.reset}`);
  console.log(`${C.bold}${C.magenta}BlitzFair —— 限量发售不再属于手最快的人。${C.reset}\n`);
})().catch(e => { console.error(e); process.exit(1); });
