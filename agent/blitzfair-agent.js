#!/usr/bin/env node
/**
 * BlitzFair Agent · 守发售智能体
 * 设定一次，它全自动帮你走完 commit → reveal → 开奖 → 退款 全流程。
 * LLM 可选：配置 LLM_API_KEY 后可用中文自然语言指挥；不配置则用规则引擎（同样好用）。
 *
 * 用法：
 *   node agent/blitzfair-agent.js status  --drop 1
 *   node agent/blitzfair-agent.js commit  --drop 1
 *   node agent/blitzfair-agent.js reveal  --drop 1
 *   node agent/blitzfair-agent.js refund  --drop 1
 *   node agent/blitzfair-agent.js watch   --drop 1     # 守发售：自动完成全流程
 *   node agent/blitzfair-agent.js chat    "帮我看看 1 号发售"
 *
 * 环境变量（.env 里已配好）：RPC PRIVATE_KEY CONTRACT
 * 可选：MONAD_MAX_MON（单次最高花费，默认 0.05） LLM_API_KEY LLM_BASE_URL LLM_MODEL
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

// ---------- 加载 .env ----------
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
const RPC = process.env.RPC || 'https://testnet-rpc.monad.xyz';
const CONTRACT = process.env.CONTRACT;
const MAX_MON = parseFloat(process.env.MONAD_MAX_MON || '0.05');
const STATE = path.join(__dirname, 'agent-state.json');
const args = process.argv.slice(2);
const CMD = args[0] || 'help';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const DROP = { value: BigInt(opt('drop', '0')) };

const ABI = [
  'function hashOf(uint256,address,bytes32) view returns (bytes32)',
  'function commit(uint256,bytes32) payable',
  'function reveal(uint256,bytes32)',
  'function draw(uint256)',
  'function claimRefund(uint256)',
  'function isWinner(uint256,address) view returns (bool)',
  'function eligibleCount(uint256) view returns (uint256)',
  'function getDrop(uint256) view returns (tuple(address issuer,string name,uint256 quota,uint256 price,uint64 commitDeadline,uint64 revealDeadline,bool drawn,uint256 committedCount,uint256 revealedCount,uint256 winners,uint256 proceeds))'
];

const provider = new ethers.JsonRpcProvider(RPC);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = CONTRACT ? new ethers.Contract(CONTRACT, ABI, wallet) : null;
const needContract = () => { if (!contract) throw new Error('请先在 .env 里设置 CONTRACT=0x…（部署后填写）'); return contract; };
const fmt = (v) => ethers.formatEther(v);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
// Monad 测试网基础费会波动，统一按 1.75 倍加价，避免间歇性失败
const txOpts = async () => {
  const fee = await provider.getFeeData();
  return fee.gasPrice ? { gasPrice: (fee.gasPrice * 7n) / 4n } : {};
};

// 本地状态：{ [dropId]: { secret, committed, revealed, refunded } }
const loadState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return {}; } };
const saveState = (s) => fs.writeFileSync(STATE, JSON.stringify(s, null, 2), { mode: 0o600 });
const st = loadState();
const my = () => (st[DROP.value.toString()] = st[DROP.value.toString()] || {});

async function status() {
  needContract();
  const d = await contract.getDrop(DROP.value);
  const now = BigInt(Math.floor(Date.now() / 1000));
  const stage = d.drawn ? '已开奖' : now < d.commitDeadline ? '提交中' : now < d.revealDeadline ? '揭示中' : '等待开奖';
  console.log(`\n📦 Drop #${DROP.value}「${d.name}」`);
  console.log(`   阶段：${stage}   名额：${d.quota}   单价：${fmt(d.price)} MON`);
  console.log(`   已提交：${d.committedCount}   已揭示：${d.revealedCount}   中签：${d.winners}`);
  const mine = my();
  console.log(`   我的状态：${mine.committed ? '已提交✅' : '未提交'}${mine.revealed ? ' · 已揭示✅' : ''}${mine.refunded ? ' · 已退款✅' : ''}`);
  if (d.drawn) console.log(`   我中签了吗？ ${(await contract.isWinner(DROP.value, wallet.address)) ? '🎉 是！' : '😢 否（可 refund 退款）'}`);
  return { d, now };
}

async function commit() {
  needContract();
  const d = await contract.getDrop(DROP.value);
  const priceMon = parseFloat(fmt(d.price));
  if (priceMon > MAX_MON) throw new Error(`单价 ${priceMon} MON 超过安全上限 ${MAX_MON} MON（export MONAD_MAX_MON 可调）`);
  const mine = my();
  if (mine.committed) return console.log('已提交过，跳过 ✅');
  const secret = ethers.hexlify(ethers.randomBytes(32));
  mine.secret = secret;
  const hash = await contract.hashOf(DROP.value, wallet.address, secret);
  console.log('⏳ 提交订单哈希…');
  const tx = await contract.commit(DROP.value, hash, { value: d.price, ...(await txOpts()) });
  await tx.wait();
  mine.committed = true; saveState(st);
  console.log(`✅ 已提交上链！tx=${tx.hash}`);
}

async function reveal() {
  needContract();
  const mine = my();
  if (!mine.committed || !mine.secret) throw new Error('本地没有该 drop 的 commit 记录（secret 丢了 → 视为未下单，款项可 refund 取回）');
  if (mine.revealed) return console.log('已揭示过，跳过 ✅');
  const tx = await contract.reveal(DROP.value, mine.secret, await txOpts());
  await tx.wait();
  mine.revealed = true; saveState(st);
  console.log(`✅ 揭示上链！tx=${tx.hash}`);
}

async function refund() {
  needContract();
  const mine = my();
  const tx = await contract.claimRefund(DROP.value, await txOpts());
  await tx.wait();
  mine.refunded = true; saveState(st);
  console.log(`✅ 已退款！tx=${tx.hash}`);
}

async function watch() {
  needContract();
  console.log(`🤖 Agent 已接管 Drop #${DROP.value}，开始守发售（每 5 秒检查一次，Ctrl+C 退出）…`);
  for (;;) {
    try {
      const { d, now } = await status();
      const mine = my();
      if (!mine.committed && now < d.commitDeadline) { console.log('→ 检测到提交窗口，自动下单…'); await commit(); }
      else if (mine.committed && !mine.revealed && now >= d.commitDeadline && now < d.revealDeadline) { console.log('→ 揭示窗口到了，自动揭示…'); await reveal(); }
      else if (d.drawn && mine.committed && !(await contract.isWinner(DROP.value, wallet.address)) && !mine.refunded) { console.log('→ 未中签，自动退款…'); await refund(); return console.log('🏁 全流程完成。'); }
      else if (d.drawn) { const won = await contract.isWinner(DROP.value, wallet.address); console.log(won ? '🏁 全流程完成：中签了！🎉' : '🏁 已结束。'); return; }
    } catch (e) { console.log('⚠️ 检查出错（会自动重试）：', e.shortMessage || e.message); }
    await sleep(5000);
  }
}

// ---------- 中文意图解析：LLM 可选，规则兜底 ----------
const RULES = [
  [/状态|看看|多少|情况|进度/, 'status'],
  [/抢|下单|提交|commit/, 'commit'],
  [/揭示|reveal|公开/, 'reveal'],
  [/退款|退钱|refund/, 'refund'],
  [/守|盯|watch|自动/, 'watch'],
];
async function chat(text) {
  const dropMatch = text.match(/(\d+)\s*号?/); const dropId = dropMatch ? BigInt(dropMatch[1]) : DROP.value;
  let intent = null;
  if (process.env.LLM_API_KEY) {
    try {
      const res = await fetch((process.env.LLM_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + process.env.LLM_API_KEY },
        body: JSON.stringify({ model: process.env.LLM_MODEL || 'gpt-4o-mini', temperature: 0, messages: [
          { role: 'system', content: '你是意图分类器，只输出一个词：status / commit / reveal / refund / watch' },
          { role: 'user', content: text }] })
      });
      const j = await res.json();
      const t = (j.choices?.[0]?.message?.content || '').trim().toLowerCase();
      if (['status','commit','reveal','refund','watch'].includes(t)) intent = t;
    } catch (e) { console.log('（LLM 不可用，回退规则引擎）'); }
  }
  if (!intent) intent = (RULES.find(([re]) => re.test(text)) || [])[1] || 'status';
  console.log(`🤖 意图识别：${intent}（Drop #${dropId}）`);
  DROP.value = dropId;
  const cmds = { status, commit, reveal, refund, watch };
  return cmds[intent]();
}

(async () => {
  switch (CMD) {
    case 'status': return status();
    case 'commit': return commit();
    case 'reveal': return reveal();
    case 'refund': return refund();
    case 'watch':  return watch();
    case 'chat':   return chat(args.slice(1).join(' ') || '看看状态');
    default:
      console.log('命令：status | commit | reveal | refund | watch | chat "中文指令"');
      console.log('示例：node agent/blitzfair-agent.js chat "帮我抢 1 号发售"');
  }
})().catch(e => { console.error('❌', e.shortMessage || e.message || e); process.exit(1); });
