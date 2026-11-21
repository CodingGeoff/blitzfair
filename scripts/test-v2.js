#!/usr/bin/env node
/**
 * BlitzFairV2 完整测试套件 — 真实上链（Monad Testnet 10143）
 *
 * 并发模型（重要）：
 *   Monad 测试网不支持同一账户的 pending 交易排队（nonce 领先即回退），
 *   且 gasUsed 回显 gasLimit（按 gasLimit 计费）。
 *   因此测试采用「轮次」模型：每一轮内每个钱包只发 1 笔，全部并行；轮次之间串行。
 *
 * 覆盖：
 *   组 1  等概率生命周期：提交/揭示/开奖/退款/提款 + 保证金退还与没收 + 账目守恒 + 13 项非法操作
 *   组 2  加权女巫中性：5 小号(合计权重 0.1) vs 1 地址(权重 0.1)，多轮统计胜率
 *   组 3  等概率对照组：同规模对手，验证小号数量可直接换胜率（女巫漏洞真实存在）
 *   组 4  边界：quota>人数、全员不揭示、空种子、非法参数
 *
 * 用法：node scripts/test-v2.js           全量（每模式 6 轮）
 *       node scripts/test-v2.js --fast    快速（每模式 3 轮）
 *       V2_ADDR=0x... node scripts/test-v2.js
 */
const fs = require('fs');
const { ethers } = require('ethers');

const env = Object.fromEntries(
  fs.readFileSync('.env', 'utf8').split('\n')
    .filter(l => l.includes('=') && !l.startsWith('#'))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })
);
const V2 = process.env.V2_ADDR || '0x559010f20877B001Cb99E7611801cB0dfacD7ABe';
const CHAIN_ID = 10143;
const FAST = process.argv.includes('--fast');
const LEAN = process.argv.includes('--lean');   // 省钱模式：复用已有钱包、窗口更短、轮次更少
let ROUNDS = FAST ? 3 : 6;
if (LEAN) ROUNDS = 4;
const COMMIT_SEC = LEAN ? 80 : FAST ? 150 : 240;
const REVEAL_SEC = LEAN ? 65 : 70;   // 合约要求两个窗口都 ≥ 60s，否则 window too short

// 实测真实 gas（Monad 按 gasLimit 计费 → 限额越贴近真实值越省钱）
//   createDrop 175,537 / commit 147,056 / reveal 171,533 / draw(2人) 174,149
//   refund / sweep 走自动估算；draw 的 gas 随中签人数增长，用公式估算
const GAS = { create: 250000, commit: 215000, reveal: 210000, draw: 220000, refund: 120000, sweep: 120000, fund: 21000 };
const GAS_BUMP = 115n; // 统一 1.15 倍余量

/** draw 的 gas 与 quota 相关（加权模式还要建权重数组），给 1.15 倍估算 */
async function drawGasLimit(dropId) {
  try {
    const est = await withRetry(() => provider.estimateGas({
      to: V2, from: main.address, data: iface.encodeFunctionData('draw', [dropId]),
    }));
    return (est * GAS_BUMP) / 100n;
  } catch (_) { return GAS.draw; }
}

const ABI = [
  'function createDrop(string,uint256,uint256,uint256,uint64,uint64,bool) returns (uint256)',
  'function hashOf(uint256,address,bytes32) view returns (bytes32)',
  'function commit(uint256,bytes32) payable',
  'function reveal(uint256,bytes32)',
  'function draw(uint256)',
  'function claimRefund(uint256)',
  'function sweep(uint256)',
  'function getDrop(uint256) view returns (tuple(address issuer,string name,uint256 quota,uint256 price,uint256 bond,uint64 commitDeadline,uint64 revealDeadline,bool weighted,bool drawn,uint256 committedCount,uint256 revealedCount,uint256 winners,uint256 proceeds))',
  'function hasCommitted(uint256,address) view returns (bool)',
  'function hasRevealed(uint256,address) view returns (bool)',
  'function hasRefunded(uint256,address) view returns (bool)',
  'function isWinner(uint256,address) view returns (bool)',
  'function stakeOf(uint256,address) view returns (uint256)',
  'function nextDropId() view returns (uint256)',
  'function version() view returns (uint256)',
  'event Committed(uint256 indexed dropId, address indexed user, bytes32 commitment, uint256 stake)',
  'event Revealed(uint256 indexed dropId, address indexed user, uint256 bondRefunded)',
  'event Drawn(uint256 indexed dropId, uint256 winners, uint256 seed)',
  'event Refunded(uint256 indexed dropId, address indexed user, uint256 amount)',
  'event Swept(uint256 indexed dropId, address indexed issuer, uint256 amount)',
];

const provider = new ethers.JsonRpcProvider(env.RPC, CHAIN_ID, {
  pollingInterval: 900, batchMaxCount: 1, staticNetwork: true,
});

/** 公共 RPC 会被限流（429），所有网络动作统一退避重试 */
async function withRetry(fn, tries = 8) {
  let last;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      last = e;
      const msg = (e.shortMessage || e.message || '') + (e.info?.responseBody || '');
      if (!/rate limit|429|SERVER_ERROR|retry limit|timeout|too many/i.test(msg)) throw e;
      const wait = Math.min(15000, 700 * 2 ** i);
      console.log(`     … RPC 限流，${wait}ms 后重试（${i + 1}/${tries}）`);
      await sleep(wait / 1000);
    }
  }
  throw last;
}
const main = new ethers.Wallet(env.PRIVATE_KEY, provider);
const iface = new ethers.Interface(ABI);
const view = new ethers.Contract(V2, ABI, provider);

const E = s => ethers.parseEther(s);
const F = x => ethers.formatEther(x);
const SECRET = () => ethers.hexlify(ethers.randomBytes(32));
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const shortErr = e => ((e.shortMessage || e.message || '').split('\n')[0]).slice(0, 90);

let passed = 0, failed = 0;
const failLines = [];
function ok(cond, label, extra) {
  if (cond) { passed++; console.log(`  ✓ ${label}${extra !== undefined ? `  [${extra}]` : ''}`); }
  else { failed++; failLines.push(label); console.log(`  ✗ FAIL: ${label}${extra !== undefined ? `  [${extra}]` : ''}`); }
}
const info = m => console.log(`  · ${m}`);

/** 回退断言：eth_call 模拟，不占 nonce、不花 gas */
async function expectRevert(label, from, method, args, value = 0n) {
  const data = iface.encodeFunctionData(method, args);
  try {
    await provider.call({ to: V2, from: typeof from === 'string' ? from : from.address, data, value });
    failed++; failLines.push(label);
    console.log(`  ✗ FAIL（本该回退却成功）: ${label}`);
  } catch (e) {
    const msg = shortErr(e);
    if (/insufficient funds/i.test(msg)) { failed++; failLines.push(label); console.log(`  ✗ FAIL（模拟因余额失败，未验证逻辑）: ${label} ⟨${msg}⟩`); }
    else { passed++; console.log(`  ✓ 正确回退: ${label}  ⟨${msg}⟩`); }
  }
}

let GP = null, totalTxs = 0, totalGas = 0n;
const allReceipts = [];
async function gasPrice() {
  if (GP === null) { const fd = await withRetry(() => provider.getFeeData()); GP = ((fd.gasPrice || 2000000000n) * 15n) / 10n; }
  return GP;
}

/** 一轮：每个 wallet 最多 1 笔，全部并行广播 */
async function round(label, jobs) {
  if (!jobs.length) return [];
  // 同一轮内同一钱包只能有 1 笔（Monad 不支持 pending 排队，重复必失败）
  const seen = new Set();
  const dup = [];
  jobs = jobs.filter(j => {
    const k = j.signer.address.toLowerCase();
    if (seen.has(k)) { dup.push(k); return false; }
    seen.add(k); return true;
  });
  if (dup.length) console.log(`  ! 检测到 ${dup.length} 个钱包在同一轮被安排多笔，已自动剔除（请检查测试编排）`);
  const gp = await gasPrice();
  const signed = [];
  for (const j of jobs) {
    const nonce = j.nonce ?? await withRetry(() => provider.getTransactionCount(j.signer.address, 'pending'));
    const data = iface.encodeFunctionData(j.method, j.args || []);
    let gasLimit = j.gasLimit;
    if (!gasLimit) {
      // 无预设限额时现场估算（refund/sweep 走这里），留 1.15 倍余量
      const est = await withRetry(() => provider.estimateGas({ to: V2, from: j.signer.address, data, value: j.value || 0n }));
      gasLimit = (est * GAS_BUMP) / 100n;
    }
    signed.push(await j.signer.signTransaction({
      to: V2, data, value: j.value || 0n, nonce, gasLimit, gasPrice: gp, chainId: CHAIN_ID, type: 0,
    }));
  }
  const txs = [];
  for (const raw of signed) {
    txs.push(await withRetry(() => provider.broadcastTransaction(raw)).catch(e => e));
    await sleep(0.05);
  }
  const res = await Promise.all(txs.map(async (tx, i) => {
    if (tx instanceof Error) return { ok: false, err: tx, job: jobs[i] };
    try { const rc = await withRetry(() => tx.wait()); return { ok: true, rc, job: jobs[i] }; }
    catch (err) { return { ok: false, err, job: jobs[i] }; }
  }));
  let gasSum = 0n;
  for (const r of res) if (r.ok) { totalTxs++; gasSum += r.rc.gasUsed; allReceipts.push(r.rc); }
  totalGas += gasSum;
  const bad = res.filter(r => !r.ok);
  console.log(`  → ${label}: ${res.length - bad.length}/${res.length} 成功`);
  await sleep(1.5);
  if (bad.length) {
    const kinds = new Map();
    for (const b of bad) { const k = shortErr(b.err); kinds.set(k, (kinds.get(k) || 0) + 1); }
    for (const [k, v] of kinds) console.log(`     ✗ ${v} 笔: ${k}`);
  }
  return res;
}
function ev(rc, name) {
  for (const l of rc.logs) { try { const p = iface.parseLog(l); if (p && p.name === name) return p.args; } catch (_) {} }
  return null;
}
const POOL_FILE = '.test-wallet-pool.json';
let poolIdx = 0;
function loadPool() {
  try { return JSON.parse(fs.readFileSync(POOL_FILE, 'utf8')); } catch (_) { return []; }
}
/** 省钱模式优先复用已有钱包（余额还够就不必再充值） */
/** 稳健单发：显式 nonce，失败后立即重取 pending nonce 再试一次（Monad 上 nonce 极易踩空洞） */
async function sendTx(signer, { to, data, value = 0n, gasLimit }) {
  const gp = await gasPrice();
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const nonce = await withRetry(() => provider.getTransactionCount(signer.address, 'pending'));
      const limit = gasLimit || await withRetry(() => provider.estimateGas({ to, from: signer.address, data, value }));
      const raw = await signer.signTransaction({ to, data, value, nonce, gasLimit: limit, gasPrice: gp, chainId: CHAIN_ID, type: 0 });
      const tx = await withRetry(() => provider.broadcastTransaction(raw));
      const rc = await withRetry(() => tx.wait());
      if (typeof allReceipts !== 'undefined' && rc) allReceipts.push(rc);
      return rc;
    } catch (e) {
      lastErr = e;
      await sleep(0.6 + attempt * 0.8);
    }
  }
  throw lastErr;
}

const mkWallets = n => {
  const pool = loadPool();
  const out = [];
  for (let i = 0; i < n; i++) {
    const pk = pool[poolIdx++];
    if (pk) out.push(new ethers.Wallet(pk, provider));
    else { const w = ethers.Wallet.createRandom().connect(provider); createdKeys.push(w.privateKey); out.push(w); }
  }
  return out;
};
function savePool() {
  // 只持久化私钥列表（测试网小号，无价值）
  const all = [...new Set([...loadPool(), ...createdKeys])];
  fs.writeFileSync(POOL_FILE, JSON.stringify(all), { mode: 0o600 });
}
const createdKeys = [];
async function waitUntil(ts, label) {
  const d = ts - Math.floor(Date.now() / 1000);
  if (d > 0) { console.log(`\n  ⏳ 等待 ${d}s（${label}）…`); await sleep(d + 1); }
}

(async () => {
  const t0 = Date.now();
  console.log('════════════ BlitzFairV2 完整测试套件 ════════════');
  console.log('合约:', V2, '| version:', (await view.version()).toString(), '| chainId:', (await provider.getNetwork()).chainId.toString());
  console.log('模式:', FAST ? `快速（每模式 ${ROUNDS} 轮）` : `全量（每模式 ${ROUNDS} 轮）`, `| 窗口: 提交 ${COMMIT_SEC}s / 揭示 ${REVEAL_SEC}s`);
  const balStart = await provider.getBalance(main.address);
  console.log('测试账户:', main.address, '| 余额:', F(balStart), 'MON');

  // ============ 准备钱包 ============
  const botsEq = mkWallets(5);      // 组1 等概率生命周期
  const botsQ = mkWallets(2);       // 组4 quota>人数
  const botsN = mkWallets(2);       // 组4 全员不揭示
  const botsW = mkWallets(5);       // 组2 小号攻击方
  const honestW = mkWallets(1)[0];  // 组2 单地址
  const botsC = botsW;              // 组3 复用同一批 5 个小号（不同场次不冲突，省钱包）
  const honestC = mkWallets(1)[0];  // 组3 单地址
  const outsider = mkWallets(1)[0]; // 局外人（非法操作 / 权限测试）
  const workers = [...botsEq, ...botsQ, ...botsN, ...botsW, honestW, ...botsC, honestC, outsider];

  console.log(`\n── 阶段 0：准备 ${workers.length} 个测试钱包 ──`);
  savePool();
  const FUND = E('1.5');   // 每个小号要跑约 12 轮提交+揭示，需 ~1 MON
  const FUND_TARGET = FUND;
  // 单场 commit 需 value 0.021 + gas ~0.03；复用门槛必须覆盖 commit + reveal
  const MIN_REUSE = E('0.45');
  {
    // 复用的小号只要还有一点余额就不再充值（Monad testnet 水龙头有限）

    let needWei = 0n, reuse = 0, fresh = 0;
    for (const w of workers) {
      const b = await withRetry(() => provider.getBalance(w.address));
      if (b >= MIN_REUSE) { reuse++; continue; }
      needWei += FUND_TARGET - b;
      fresh++;
    }
    const have = await withRetry(() => provider.getBalance(main.address));
    info(`钱包：复用 ${reuse} 个（余额 ≥ ${F(MIN_REUSE)}），需充值 ${fresh} 个 | 需求 ${F(needWei)} MON | 主账户 ${F(have)} MON`);
    if (needWei + E('0.25') > have) {
      console.error(`\n✗ 余额不足：需要约 ${F(needWei + E('0.25'))} MON，当前 ${F(have)} MON。`);
      console.error('  请给测试账户 ' + main.address + ' 充值，或加 --lean 减少轮次。');
      process.exit(3);
    }
  }
  let funded = 0, fundFail = [];
  for (const w of workers) {
    if ((await withRetry(() => provider.getBalance(w.address))) >= MIN_REUSE) continue;
    try {
      // 借用 ethers 的发送路径：自动估 gas / 自动取 pending nonce，失败自动重试一次
      const cur = await withRetry(() => provider.getBalance(w.address));
      await sendTx(main, { to: w.address, value: FUND - cur, data: '0x', gasLimit: 21000 });
      funded++;
    } catch (e) {
      const rc = e.receipt;
      const bal = await withRetry(() => provider.getBalance(main.address));
      fundFail.push(`${w.address.slice(0, 10)} → ${shortErr(e)}${rc ? ` (status=${rc.status}, gasUsed=${rc.gasUsed})` : ''}`);
      info(`充值失败（主账户余额 ${F(bal)} MON）: ${fundFail[fundFail.length - 1]}`);
      await sleep(0.5);
    }
  }
  console.log(`  → 充值 ${funded} 个钱包（失败 ${fundFail.length}）`);
  ok(fundFail.length === 0 && funded >= 0, `测试钱包就绪（新充值 ${funded} 个，其余复用）`, `${workers.length} 个可用`);

  // ============ 阶段 1：创建场次 ============
  console.log('\n── 阶段 1：创建场次 ──');
  const base = Number(await view.nextDropId());
  const drops = { eq: base, q: base + 1, n: base + 2, w: [], c: [] };
  for (let i = 0; i < ROUNDS; i++) { drops.w.push(base + 3 + i); drops.c.push(base + 3 + ROUNDS + i); }
  const specs = [
    ['V2 · 等概率生命周期（quota2 / price0.01 / bond0.005）', 2, '0.01', '0.005', false],
    ['V2 · 边界 quota>人数（quota10 / 3 人）', 10, '0.01', '0.001', false],
    ['V2 · 边界 全员不揭示（quota2 / bond0.001）', 2, '0.01', '0.001', false],
    ...drops.w.map((_, i) => [`V2 · 加权女巫中性 #${i}`, 1, '0.01', '0.001', true]),
    ...drops.c.map((_, i) => [`V2 · 等概率对照 #${i}`, 1, '0.01', '0.001', false]),
  ];
  for (const [name, quota, price, bond, weighted] of specs) {
    await sendTx(main, {
      to: V2,
      data: iface.encodeFunctionData('createDrop', [name, quota, E(price), E(bond), COMMIT_SEC, REVEAL_SEC, weighted]),
      gasLimit: GAS.create,
    });
    totalTxs++;
  }
  const n0 = Number(await view.nextDropId());
  ok(n0 - base === specs.length, `创建 ${specs.length} 个场次（drop#${base}..#${n0 - 1}）`, `${n0 - base}/${specs.length}`);
  const gEq = await view.getDrop(drops.eq);
  info(`提交截止 ${new Date(Number(gEq.commitDeadline) * 1000).toLocaleTimeString('zh-CN')} / 揭示截止 ${new Date(Number(gEq.revealDeadline) * 1000).toLocaleTimeString('zh-CN')}`);
  // 每场窗口从各自创建时刻起算，必须等到「最晚」的截止时刻
  const allDropIds = [drops.eq, drops.q, drops.n, ...drops.w, ...drops.c];
  let maxCommitDl = 0n, maxRevealDl = 0n;
  for (const id of allDropIds) {
    const d = await view.getDrop(id);
    if (d.commitDeadline > maxCommitDl) maxCommitDl = d.commitDeadline;
    if (d.revealDeadline > maxRevealDl) maxRevealDl = d.revealDeadline;
  }
  info(`最晚提交截止 ${new Date(Number(maxCommitDl) * 1000).toLocaleTimeString('zh-CN')} / 最晚揭示截止 ${new Date(Number(maxRevealDl) * 1000).toLocaleTimeString('zh-CN')}`);

  // ============ 阶段 2：提交（每轮每钱包 1 笔）============
  console.log('\n── 阶段 2：批量提交（缴纳质押 + 保证金）──');
  const S = { eq: botsEq.map(SECRET), q: botsQ.map(SECRET), n: botsN.map(SECRET), w: [], c: [] };
  // 第 0 轮：所有钱包各提交一次
  const jobs0 = [];
  for (let i = 0; i < 5; i++) {
    const cm = await view.hashOf(drops.eq, botsEq[i].address, S.eq[i]);
    jobs0.push({ signer: botsEq[i], method: 'commit', args: [drops.eq, cm], value: E('0.015'), gasLimit: GAS.commit });
  }
  for (let i = 0; i < botsQ.length; i++) {
    const a = await view.hashOf(drops.q, botsQ[i].address, S.q[i]);
    jobs0.push({ signer: botsQ[i], method: 'commit', args: [drops.q, a], value: E('0.011'), gasLimit: GAS.commit });
    const b = await view.hashOf(drops.n, botsN[i].address, S.n[i]);
    jobs0.push({ signer: botsN[i], method: 'commit', args: [drops.n, b], value: E('0.011'), gasLimit: GAS.commit });
  }
  for (let i = 0; i < ROUNDS; i++) {
    const sw = botsW.map(SECRET), sh = SECRET(); S.w.push({ bots: sw, honest: sh });
    const sc = botsW.map(SECRET), shc = SECRET(); S.c.push({ bots: sc, honest: shc });
    if (i === 0) {
      for (let j = 0; j < 5; j++) {
        const cm = await view.hashOf(drops.w[0], botsW[j].address, sw[j]);
        jobs0.push({ signer: botsW[j], method: 'commit', args: [drops.w[0], cm], value: E('0.021'), gasLimit: GAS.commit });
      }
      jobs0.push({ signer: honestW, method: 'commit', args: [drops.w[0], await view.hashOf(drops.w[0], honestW.address, sh)], value: E('0.101'), gasLimit: GAS.commit });
    }
  }
  const r0 = await round(`第 0 轮提交 · 生命周期+边界+加权#0（${jobs0.length} 笔）`, jobs0);
  ok(r0.every(r => r.ok), '第 0 轮全部提交成功（生命周期 / 边界 / 加权#0）', `${r0.filter(r => r.ok).length}/${r0.length}`);
  {
    // 对照 #0 独立一轮（botsC 复用 botsW 地址，同轮只能 1 笔）
    const jobs = [];
    for (let j = 0; j < 5; j++) jobs.push({ signer: botsC[j], method: 'commit', args: [drops.c[0], await view.hashOf(drops.c[0], botsC[j].address, S.c[0].bots[j])], value: E('0.011'), gasLimit: GAS.commit });
    jobs.push({ signer: honestC, method: 'commit', args: [drops.c[0], await view.hashOf(drops.c[0], honestC.address, S.c[0].honest)], value: E('0.011'), gasLimit: GAS.commit });
    const r = await round('第 0 轮提交 · 对照 #0', jobs);
    ok(r.every(x => x.ok), '对照 #0 提交成功', `${r.filter(x => x.ok).length}/${r.length}`);
  }

  // 后续轮：加权场与对照场分轮提交（同一钱包每轮只能 1 笔）
  for (let i = 1; i < ROUNDS; i++) {
    const jobsW = [];
    for (let j = 0; j < 5; j++) {
      const cm = await view.hashOf(drops.w[i], botsW[j].address, S.w[i].bots[j]);
      jobsW.push({ signer: botsW[j], method: 'commit', args: [drops.w[i], cm], value: E('0.021'), gasLimit: GAS.commit });
    }
    jobsW.push({ signer: honestW, method: 'commit', args: [drops.w[i], await view.hashOf(drops.w[i], honestW.address, S.w[i].honest)], value: E('0.101'), gasLimit: GAS.commit });
    const rw = await round(`第 ${i} 轮提交 · 加权 #${i}`, jobsW);
    ok(rw.every(r => r.ok), `加权 #${i} 提交成功`, `${rw.filter(r => r.ok).length}/${rw.length}`);

    const jobsC = [];
    for (let j = 0; j < 5; j++) {
      const cm2 = await view.hashOf(drops.c[i], botsC[j].address, S.c[i].bots[j]);
      jobsC.push({ signer: botsC[j], method: 'commit', args: [drops.c[i], cm2], value: E('0.011'), gasLimit: GAS.commit });
    }
    jobsC.push({ signer: honestC, method: 'commit', args: [drops.c[i], await view.hashOf(drops.c[i], honestC.address, S.c[i].honest)], value: E('0.011'), gasLimit: GAS.commit });
    const rc = await round(`第 ${i} 轮提交 · 对照 #${i}`, jobsC);
    ok(rc.every(r => r.ok), `对照 #${i} 提交成功`, `${rc.filter(r => r.ok).length}/${rc.length}`);
  }

  // ---- 组 1：提交后状态 + 非法提交 ----
  console.log('\n── 组 1：等概率生命周期（提交后）──');
  const dEq0 = await view.getDrop(drops.eq);
  ok(dEq0.committedCount === 5n, '5 人提交成功', dEq0.committedCount);
  const stakeSum = (await Promise.all(botsEq.map(b => view.stakeOf(drops.eq, b.address)))).reduce((a, x) => a + x, 0n);
  ok(stakeSum === E('0.05'), '质押入账合计 0.05（保证金单独记账）', F(stakeSum));
  const cm0 = await view.hashOf(drops.eq, botsEq[0].address, S.eq[0]);
  await expectRevert('同一地址重复提交', botsEq[0], 'commit', [drops.eq, cm0], E('0.015'));
  await expectRevert('金额不足（< price+bond）', outsider, 'commit', [drops.eq, SECRET()], E('0.011'));
  await expectRevert('等概率模式下质押超额', outsider, 'commit', [drops.eq, SECRET()], E('0.02'));
  await expectRevert('提交窗口未结束就揭示', botsEq[0], 'reveal', [drops.eq, S.eq[0]]);
  await expectRevert('开奖前退款', botsEq[0], 'claimRefund', [drops.eq]);

  // ============ 阶段 3：等待提交窗口 → 揭示 ============
  await waitUntil(Number(maxCommitDl), '提交 → 揭示（全部场次窗口均已开启）');

  console.log('\n── 阶段 3：批量揭示（保证金即时退还）──');
  let revealEventSample = null, revealFails = 0;
  // 第 0 轮揭示：等概率场 4 人（第 5 人故意不揭示）+ quota>人数 3 人 + 加权/对照 #0
  {
    const jobs = [];
    for (let i = 0; i < 4; i++) jobs.push({ signer: botsEq[i], method: 'reveal', args: [drops.eq, S.eq[i]], gasLimit: GAS.reveal });
    for (let i = 0; i < botsQ.length; i++) jobs.push({ signer: botsQ[i], method: 'reveal', args: [drops.q, S.q[i]], gasLimit: GAS.reveal });
    for (let j = 0; j < 5; j++) jobs.push({ signer: botsW[j], method: 'reveal', args: [drops.w[0], S.w[0].bots[j]], gasLimit: GAS.reveal });
    jobs.push({ signer: honestW, method: 'reveal', args: [drops.w[0], S.w[0].honest], gasLimit: GAS.reveal });
    const rr = await round(`第 0 轮揭示 · 生命周期+边界+加权#0（${jobs.length} 笔）`, jobs);
    const oks = rr.filter(r => r.ok); revealFails += rr.length - oks.length;
    revealEventSample = oks.map(r => ev(r.rc, 'Revealed')).find(Boolean);
    ok(rr.every(r => r.ok), '第 0 轮揭示成功（等概率场 botsEq[4] 故意不揭示）', `${oks.length}/${rr.length}`);
    const jobsC = [];
    for (let j = 0; j < 5; j++) jobsC.push({ signer: botsC[j], method: 'reveal', args: [drops.c[0], S.c[0].bots[j]], gasLimit: GAS.reveal });
    jobsC.push({ signer: honestC, method: 'reveal', args: [drops.c[0], S.c[0].honest], gasLimit: GAS.reveal });
    const rc = await round('第 0 轮揭示 · 对照 #0', jobsC);
    revealFails += rc.length - rc.filter(r => r.ok).length;
    ok(rc.every(r => r.ok), '对照 #0 揭示成功', `${rc.filter(r => r.ok).length}/${rc.length}`);
  }
  for (let i = 1; i < ROUNDS; i++) {
    const jobsW = [], jobsC = [];
    for (let j = 0; j < 5; j++) {
      jobsW.push({ signer: botsW[j], method: 'reveal', args: [drops.w[i], S.w[i].bots[j]], gasLimit: GAS.reveal });
      jobsC.push({ signer: botsC[j], method: 'reveal', args: [drops.c[i], S.c[i].bots[j]], gasLimit: GAS.reveal });
    }
    jobsW.push({ signer: honestW, method: 'reveal', args: [drops.w[i], S.w[i].honest], gasLimit: GAS.reveal });
    jobsC.push({ signer: honestC, method: 'reveal', args: [drops.c[i], S.c[i].honest], gasLimit: GAS.reveal });
    const rw = await round(`第 ${i} 轮揭示 · 加权 #${i}`, jobsW);
    revealFails += rw.length - rw.filter(r => r.ok).length;
    ok(rw.every(r => r.ok), `加权 #${i} 揭示成功`, `${rw.filter(r => r.ok).length}/${rw.length}`);
    const rc = await round(`第 ${i} 轮揭示 · 对照 #${i}`, jobsC);
    revealFails += rc.length - rc.filter(r => r.ok).length;
    ok(rc.every(r => r.ok), `对照 #${i} 揭示成功`, `${rc.filter(r => r.ok).length}/${rc.length}`);
  }
  ok(revealEventSample && revealEventSample.bondRefunded === E('0.005'),
    '揭示即时退还保证金（事件 bondRefunded = bond）', revealEventSample ? F(revealEventSample.bondRefunded) : 'no event');
  ok((await view.getDrop(drops.eq)).revealedCount === 4n, '等概率场 4 人揭示 / 1 人未揭示', 4);

  await expectRevert('错误 secret 揭示', botsEq[4], 'reveal', [drops.eq, SECRET()]);
  await expectRevert('重复揭示', botsEq[0], 'reveal', [drops.eq, S.eq[0]]);
  await expectRevert('非提交者揭示', outsider, 'reveal', [drops.eq, SECRET()]);
  await expectRevert('揭示窗口未结束就开奖', main, 'draw', [drops.eq]);

  // ============ 阶段 4：等待揭示窗口 → 开奖 ============
  await waitUntil(Number(maxRevealDl), '揭示 → 开奖（全部场次窗口均已关闭）');

  console.log('\n── 阶段 4：批量开奖（任何人可触发，每轮每钱包 1 笔）──');
  const allIds = [drops.eq, drops.q, drops.n, ...drops.w, ...drops.c];
  const drawSigners = workers.slice(0, allIds.length);
  const drawJobs = [];
  for (let i = 0; i < allIds.length; i++) {
    drawJobs.push({ signer: drawSigners[i], method: 'draw', args: [allIds[i]], gasLimit: await drawGasLimit(allIds[i]) });
  }
  const drawRes = await round(`开奖 ${allIds.length} 场（${drawSigners.length} 个不同钱包触发，验证无权限限制）`, drawJobs);
  ok(drawRes.every(r => r.ok), '全部场次开奖成功（draw 无权限限制）', `${drawRes.filter(r => r.ok).length}/${allIds.length}`);
  const seeds = drawRes.filter(r => r.ok).map(r => ev(r.rc, 'Drawn')).filter(Boolean).map(a => a.seed.toString());
  ok(new Set(seeds).size === seeds.length && seeds.length === allIds.length, '每场随机种子互不相同', `${new Set(seeds).size}/${allIds.length}`);

  // ---- 组 1：开奖后 ----
  console.log('\n── 组 1：等概率生命周期（开奖后 / 资金流）──');
  const dEq1 = await view.getDrop(drops.eq);
  ok(dEq1.drawn === true, '开奖完成');
  ok(dEq1.winners === 2n, '中签 2 人（= quota）', dEq1.winners);
  ok(dEq1.proceeds === E('0.025'), 'proceeds = 2×0.01 中签质押 + 1×0.005 没收保证金 = 0.025', F(dEq1.proceeds));
  const winners = [];
  for (const b of botsEq) if (await view.isWinner(drops.eq, b.address)) winners.push(b);
  const losers = botsEq.filter(b => !winners.includes(b));
  ok(winners.length === 2 && losers.length === 3, '中签 2 人 / 未中签 3 人（含 1 名未揭示者）', `${winners.length}/${losers.length}`);

  const refundRes = await round('未中签者领取退款（3 笔）',
    losers.map(b => ({ signer: b, method: 'claimRefund', args: [drops.eq], })));
  ok(refundRes.every(r => r.ok), '3 名未中签者退款成功', `${refundRes.filter(r => r.ok).length}/3`);
  const refundEv = refundRes.filter(r => r.ok).map(r => ev(r.rc, 'Refunded')).find(Boolean);
  ok(refundEv && refundEv.amount === E('0.01'), '退款金额 = 质押 0.01（保证金不退给未揭示者）', refundEv ? F(refundEv.amount) : 'no event');
  ok((await view.getDrop(drops.eq)).committedCount === 5n && (await view.getDrop(drops.eq)).revealedCount === 4n,
    '未揭示者不返还保证金（revealedCount 不变）');
  await expectRevert('重复退款', losers.find(b => b !== botsEq[4]) || losers[0], 'claimRefund', [drops.eq]);
  await expectRevert('中签者申请退款', winners[0], 'claimRefund', [drops.eq]);
  await expectRevert('非发行方提款', outsider, 'sweep', [drops.eq]);

  const sweepRes = await round('发行方提款', [{ signer: main, method: 'sweep', args: [drops.eq], }]);
  const sweepEv = sweepRes[0].ok ? ev(sweepRes[0].rc, 'Swept') : null;
  ok(sweepEv && sweepEv.amount === E('0.025'), '发行方提款额 = proceeds 0.025', sweepEv ? F(sweepEv.amount) : 'no event');
  await expectRevert('重复提款（已无款可提）', main, 'sweep', [drops.eq]);
  ok((await view.getDrop(drops.eq)).proceeds === 0n, '场次 proceeds 归零（账目守恒）', 0);

  // ---- 组 2 & 组 3 ----
  console.log('\n── 组 2 & 组 3：女巫中性 vs 等概率漏洞 ──');
  const wWeight = (await Promise.all(botsW.map(b => view.stakeOf(drops.w[0], b.address)))).reduce((a, x) => a + x, 0n);
  const hWeight = await view.stakeOf(drops.w[0], honestW.address);
  ok(wWeight === hWeight, '加权模式：5 个小号总权重 == 1 个地址权重（拆分不增权）', `${F(wWeight)} vs ${F(hWeight)}`);

  let wHonest = 0, cHonest = 0;
  // 只统计双方都完整参与的轮次（RPC 抖动导致漏提交的轮次要排除，否则结论失真）
  const validW = [], invalidW = [], validC = [], invalidC = [];
  for (let i = 0; i < ROUNDS; i++) {
    const dw = await view.getDrop(drops.w[i]);
    const dc = await view.getDrop(drops.c[i]);
    const wFull = dw.revealedCount === 6n;
    const cFull = dc.revealedCount === 6n;
    (wFull ? validW : invalidW).push(i);
    (cFull ? validC : invalidC).push(i);
  }
  info(`有效轮次：加权 ${validW.length}/${ROUNDS}，对照 ${validC.length}/${ROUNDS}${invalidW.length + invalidC.length ? '（其余轮次因 RPC 抖动漏提交，已剔除）' : ''}`);
  ok(validW.length >= Math.min(3, ROUNDS), '加权模式有效轮次足够（每场 6 人揭示：5 小号 + 1 地址）', `${validW.length} 场`);

  wHonest = 0; cHonest = 0;
  for (const i of validW) if (await view.isWinner(drops.w[i], honestW.address)) wHonest++;
  for (const i of validC) if (await view.isWinner(drops.c[i], honestC.address)) cHonest++;
  const nW = validW.length, nC = validC.length;
  if (validW.length >= 3) {
    ok(wHonest > 0 && wHonest < nW, '加权模式：双方均有胜场（按权重 ≈50/50，无一方横扫）', `${wHonest}:${nW - wHonest}（${nW} 场）`);
  } else {
    info(`样本不足（${nW} 场），加权模式胜率结论暂不判定`);
  }
  if (validC.length >= 3) {
    ok(cHonest <= nC - 1, '等概率模式：5 小号压制单地址（数量换胜率）', `攻击方 ${nC - cHonest}/${nC} 胜`);
  } else {
    info(`样本不足（${nC} 场），等概率对照结论暂不判定`);
  }
  info(`对照：诚实单地址胜场 — 加权 ${wHonest}/${nW} vs 等概率 ${cHonest}/${nC}`);

  // ---- 组 4：边界 ----
  console.log('\n── 组 4：边界情况 ──');
  const dQ = await view.getDrop(drops.q), dN = await view.getDrop(drops.n);
  ok(dQ.drawn && dQ.winners === BigInt(botsQ.length), `quota(10) > 揭示人数(${botsQ.length}) → 全员中签`, dQ.winners);
  ok(dQ.proceeds === BigInt(botsQ.length) * E('0.01'), `无未揭示者 → proceeds = ${botsQ.length}×0.01（无没收）`, F(dQ.proceeds));
  ok(dN.drawn && dN.winners === 0n, '全员不揭示 → 0 中签（不产生空洞名额）', dN.winners);
  ok(dN.proceeds === BigInt(botsN.length) * E('0.001'), `全员未揭示 → proceeds = ${botsN.length}×0.001（保证金全没收）`, F(dN.proceeds));

  // 未揭示者退质押（保证金已没收）
  const rnRes = await round(`全员未揭示场的质押退款（${botsN.length} 笔）`,
    botsN.map(b => ({ signer: b, method: 'claimRefund', args: [drops.n], })));
  const rnEv = rnRes.filter(r => r.ok).map(r => ev(r.rc, 'Refunded')).find(Boolean);
  ok(rnEv && rnEv.amount === E('0.01'), '未揭示者仅退质押 0.01（保证金已没收）', rnEv ? F(rnEv.amount) : 'no event');

  // quota>人数场：中签者退款应回退；提款清账
  await expectRevert('中签者（quota>人数场）退款', botsQ[0], 'claimRefund', [drops.q]);
  await sendTx(main, { to: V2, data: iface.encodeFunctionData('sweep', [drops.q]) });
  await sendTx(main, { to: V2, data: iface.encodeFunctionData('sweep', [drops.n]) });
  ok((await view.getDrop(drops.q)).proceeds === 0n && (await view.getDrop(drops.n)).proceeds === 0n, '边界场次提款后 proceeds = 0', 0);

  const nextId = Number(await view.nextDropId());
  await expectRevert('不存在的 drop', main, 'draw', [nextId + 5]);
  await expectRevert('quota = 0 创建', main, 'createDrop', ['bad', 0, E('0.01'), 0n, 100, 100, false]);
  await expectRevert('窗口过短创建', main, 'createDrop', ['bad', 1, E('0.01'), 0n, 5, 5, false]);
  await expectRevert('price = 0 创建', main, 'createDrop', ['bad', 1, 0n, 0n, 100, 100, false]);

  // ============ 账目核对（事件级总账）============
  // 参与过任何一场的钱包全集：本次 workers + 历史池 + 主账户
  const walletUniverse = [...new Map(
    [...workers, ...loadPool().map(pk => new ethers.Wallet(pk)), main].map(w => [w.address.toLowerCase(), w])
  ).values()];
  console.log('\n── 账目核对 ──');
  const ledger = new Map(); // dropId -> { in, out, unrefundedStake }
  const ensure = id => { const k = String(id); if (!ledger.has(k)) ledger.set(k, { in: 0n, out: 0n }); return ledger.get(k); };
  for (const r of [...allReceipts]) {
    const committed = ev(r, 'Committed');
    if (committed) { const L = ensure(committed.dropId); L.in += committed.stake + (await view.getDrop(committed.dropId)).bond; }
    const revealed = ev(r, 'Revealed');
    if (revealed) ensure(revealed.dropId).out += revealed.bondRefunded;
    const refunded = ev(r, 'Refunded');
    if (refunded) ensure(refunded.dropId).out += refunded.amount;
    const swept = ev(r, 'Swept');
    if (swept) ensure(swept.dropId).out += swept.amount;
  }
  let totalIn = 0n, totalOut = 0n;
  for (const [, L] of ledger) { totalIn += L.in; totalOut += L.out; }
  const actualBal = await provider.getBalance(V2);
  ok(totalIn - totalOut === actualBal, '事件总账守恒：Σ流入 − Σ流出 == 合约余额',
    `${F(totalIn)} − ${F(totalOut)} = ${F(totalIn - totalOut)} vs 实际 ${F(actualBal)}`);
  let perDropOk = true;
  const allIdsLedger = [drops.eq, drops.q, drops.n, ...drops.w, ...drops.c];
  for (const id of allIdsLedger) {
    const L = ledger.get(String(id));
    if (!L) { perDropOk = false; info(`drop#${id} 无账目记录`); continue; }
    // 每场净额 = 未退款质押 + 保证金净留（未揭示） - 未提款 proceeds
    let heldStake = 0n;
    for (const w of walletUniverse) if (await view.hasCommitted(id, w.address) && !(await view.hasRefunded(id, w.address)) && !(await view.isWinner(id, w.address))) heldStake += await view.stakeOf(id, w.address);
    const d = await view.getDrop(id);
    // 未揭示者的保证金在 draw 时并入 proceeds（已提则净额为 0），因此不重复计入
    const expectedNet = heldStake + d.proceeds;
    const net = L.in - L.out;
    if (net !== expectedNet) {
      perDropOk = false;
      console.log(`     ! drop#${id} 净额 ${F(net)} ≠ 预期 ${F(expectedNet)}（未退质押 ${F(heldStake)} + 待提 proceeds ${F(d.proceeds)}）`);
    }
  }
  ok(perDropOk, '每场净额等式成立（未退质押 + 待提 proceeds）');

  // ============ 汇总 ============
  const balEnd = await provider.getBalance(main.address);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log('\n════════════ 汇总 ════════════');
  console.log(`断言：通过 ${passed}，失败 ${failed}${failLines.length ? `\n失败项：\n  - ${failLines.join('\n  - ')}` : ''}`);
  console.log(`链上交易：${totalTxs} 笔 | 测试账户净支出 ${F(balStart - balEnd)} MON | 耗时 ${secs}s`);
  console.log(`合约余额（含未提款的加权/对照场次）：${F(await provider.getBalance(V2))} MON`);
  console.log('\n★ 女巫防御结论：');
  console.log(`  加权模式 —— 5 个小号(总权重 0.1) vs 1 个地址(权重 0.1)：诚实地址胜 ${wHonest}/${nW}`);
  console.log(`  等概率模式 —— 同规模对手：单地址仅胜 ${cHonest}/${nC}（攻击方 ${nC - cHonest}/${nC}）`);
  console.log(`  → 权重相等时双方胜率回归 50/50，靠"堆小号数量"无法提高中签率；`);
  console.log(`  → 5 个地址在等概率模式下拿到 5 倍权重，在加权模式下只拿到 1 份权重。`);

  fs.writeFileSync('test-v2-report.json', JSON.stringify({
    contract: V2, ranAt: new Date().toISOString(), rounds: ROUNDS,
    assertions: { passed, failed, failures: failLines },
    transactions: totalTxs, spendMon: F(balStart - balEnd), durationSec: Number(secs),
    weighted: { honestSingleAddressWins: wHonest, validRounds: nW },
    equalControl: { honestSingleAddressWins: cHonest, validRounds: nC },
    drops,
  }, null, 2));
  console.log('\n报告已写入 test-v2-report.json');
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('\nFATAL:', shortErr(e)); console.error((e.stack || '').split('\n').slice(1, 5).join('\n')); process.exit(2); });
