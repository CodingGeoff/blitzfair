#!/usr/bin/env node
/**
 * 本地全流程演示：一条命令跑完一场发售。
 *
 *   node scripts/local-demo.js              # 建场 → 下单 → 等窗口 → 揭示 → 开奖 → 退款 → 提款
 *   node scripts/local-demo.js --prepare    # 只做建场与下单，之后自己手动走（适合现场分段演示）
 *   node scripts/local-demo.js --accounts 8 # 指定参与账户数（默认 15）
 *   node scripts/local-demo.js --commit 60 --reveal 45   # 自定义窗口秒数
 *
 * 说明
 *  - 参与账户是每次运行临时生成的一次性测试钱包，只在本次运行内存里存在，不落盘、不入库。
 *  - 需要 .env 里的 PRIVATE_KEY（测试钱包，负责部署/建场/资助/提款）与 RPC。
 *  - 全部是真实链上交易，只是金额是测试币。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { ethers } = require('ethers');

const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const args = process.argv.slice(2);
const flag = (n) => args.includes('--' + n);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };

const RPC = process.env.RPC || 'https://testnet-rpc.monad.xyz';
const KEY = process.env.PRIVATE_KEY;
const N = parseInt(opt('accounts', process.env.DEMO_ACCOUNTS || '15'), 10);
const COMMIT_SEC = parseInt(opt('commit', '90'), 10);
const REVEAL_SEC = parseInt(opt('reveal', '60'), 10);
const PRICE = ethers.parseEther(opt('price', '0.01'));
const QUOTA = parseInt(opt('quota', '10'), 10);

const ABI = [
  'function createDrop(string,uint256,uint256,uint64,uint64) returns (uint256)',
  'function hashOf(uint256,address,bytes32) view returns (bytes32)',
  'function commit(uint256,bytes32) payable',
  'function reveal(uint256,bytes32)',
  'function draw(uint256)',
  'function claimRefund(uint256)',
  'function sweep(uint256)',
  'function isWinner(uint256,address) view returns (bool)',
  'function eligibleCount(uint256) view returns (uint256)',
  'function getDrop(uint256) view returns (tuple(address issuer,string name,uint256 quota,uint256 price,uint64 commitDeadline,uint64 revealDeadline,bool drawn,uint256 committedCount,uint256 revealedCount,uint256 winners,uint256 proceeds))',
];

const provider = new ethers.JsonRpcProvider(RPC);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v) => ethers.formatEther(v);
const log = (...a) => console.log(...a);

async function txOpts() {
  const fee = await provider.getFeeData();
  return fee.gasPrice ? { gasPrice: (fee.gasPrice * 7n) / 4n } : {};
}
async function chainNow() {
  return BigInt((await provider.getBlock('latest')).timestamp);
}
async function waitUntil(ts, label) {
  for (;;) {
    const now = await chainNow();
    if (now >= ts) return;
    const left = Number(ts - now);
    process.stdout.write(`\r   ⏳ ${label}：还有 ${left}s   `);
    await sleep(Math.min(3000, Math.max(400, left * 200)));
  }
}

(async () => {
  if (!KEY || /^0x0{64}$/.test(KEY)) {
    console.error('❌ 先在 .env 里填 PRIVATE_KEY（一次性测试钱包，不要用真实资产钱包）');
    process.exit(1);
  }
  const issuer = new ethers.Wallet(KEY, provider);
  const chainId = (await provider.getNetwork()).chainId;
  log(`\n🔗 网络 chainId=${chainId} · 发行方 ${issuer.address} · 余额 ${fmt(await provider.getBalance(issuer.address))} MON`);

  // ---------- 1. 部署 ----------
  let contractAddr = process.env.CONTRACT;
  const artifact = compile();
  if (!contractAddr || flag('deploy')) {
    log('📦 部署合约…');
    const f = new ethers.ContractFactory(artifact.abi, artifact.bytecode, issuer);
    const c = await f.deploy(await txOpts());
    await c.waitForDeployment();
    contractAddr = await c.getAddress();
    log(`   ✅ ${contractAddr}`);
    fs.appendFileSync(envPath, `CONTRACT=${contractAddr}\n`);
  } else {
    log(`📦 复用已有合约 ${contractAddr}`);
  }
  const asIssuer = new ethers.Contract(contractAddr, ABI, issuer);
  const read = new ethers.Contract(contractAddr, ABI, provider);

  // ---------- 2. 建场 ----------
  log(`🎬 创建发售：${QUOTA} 个名额 · 单价 ${fmt(PRICE)} MON · 提交窗 ${COMMIT_SEC}s · 揭示窗 ${REVEAL_SEC}s`);
  const rc = await (await asIssuer.createDrop('演示发售 · 限量 ' + QUOTA + ' 份', QUOTA, PRICE, COMMIT_SEC, REVEAL_SEC, await txOpts())).wait();
  const dropId = BigInt((await read.nextDropId ? await read.nextDropId() : 0n)) || 0n;
  const d0 = await read.getDrop(dropId).catch(() => null);
  log(`   ✅ Drop #${dropId}（备查：${rc.hash}）`);

  // ---------- 3. 一次性测试账户下单 ----------
  log(`👥 生成 ${N} 个一次性测试账户，资助并下单…`);
  const wallets = Array.from({ length: N }, () => ethers.Wallet.createRandom().connect(provider));
  const secrets = wallets.map(() => ethers.hexlify(ethers.randomBytes(32)));
  const d = d0 || (await read.getDrop(dropId));
  const fund = PRICE + ethers.parseEther('0.03');
  let i = 0;
  for (const [idx, w] of wallets.entries()) {
    await (await issuer.sendTransaction({ to: w.address, value: fund, ...(await txOpts()) })).wait();
    const h = await read.hashOf(dropId, w.address, secrets[idx]);
    await (await new ethers.Contract(contractAddr, ABI, w).commit(dropId, h, { value: d.price, ...(await txOpts()) })).wait();
    i++;
    process.stdout.write(`\r   ✅ 已下单 ${i}/${N}   `);
  }
  log(`\n   当前已提交：${(await read.getDrop(dropId)).committedCount}`);

  if (flag('prepare')) {
    log(`\n⏸  已准备完成。稍后运行：node scripts/local-demo.js --resume --drop ${dropId}`);
    return;
  }

  // ---------- 4. 揭示 ----------
  const dd = await read.getDrop(dropId);
  await waitUntil(BigInt(dd.commitDeadline), '等待提交窗口关闭');
  log('\n🔓 提交窗口已关闭，逐个揭示…');
  let j = 0;
  for (const [idx, w] of wallets.entries()) {
    try {
      await (await new ethers.Contract(contractAddr, ABI, w).reveal(dropId, secrets[idx], await txOpts())).wait();
      j++;
      process.stdout.write(`\r   ✅ 已揭示 ${j}/${N}   `);
    } catch (e) {
      process.stdout.write(`\r   ⚠️ 第 ${idx} 个揭示失败：${String(e.shortMessage || e.message).slice(0, 60)}\n`);
    }
  }

  // ---------- 5. 开奖 ----------
  await waitUntil(BigInt((await read.getDrop(dropId)).revealDeadline), '等待揭示窗口关闭');
  log('\n🎲 开奖（任何人都能触发）…');
  const drawRc = await (await asIssuer.draw(dropId, await txOpts())).wait();
  const after = await read.getDrop(dropId);
  log(`   ✅ 中签 ${after.winners} 人 · 应收货款 ${fmt(after.proceeds)} MON`);

  // ---------- 6. 未中签退款 ----------
  log('💸 未中签者退款…');
  let refunded = 0;
  for (const [idx, w] of wallets.entries()) {
    if (await read.isWinner(dropId, w.address)) continue;
    await (await new ethers.Contract(contractAddr, ABI, w).claimRefund(dropId, await txOpts())).wait();
    refunded++;
  }
  log(`   ✅ 已退 ${refunded} 笔 · ${fmt(BigInt(refunded) * d.price)} MON 回到各账户`);

  // ---------- 7. 发行方提款 ----------
  await (await asIssuer.sweep(dropId, await txOpts())).wait();
  log(`💰 发行方提款完成 · 合约余额 ${fmt(await provider.getBalance(contractAddr))} MON`);

  log(`\n🏁 全流程完成。Drop #${dropId}`);
  log(`   开奖交易：${drawRc.hash}`);
  log(`   账户明细可在区块浏览器按地址查看；合约 ${contractAddr}`);
})().catch((e) => {
  console.error('\n❌', e.shortMessage || e.message || e);
  process.exit(1);
});

// 用 solc 现场编译合约，省掉 extra 构建步骤
function compile() {
  const solc = require('solc');
  const src = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'BlitzFair.sol'), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'BlitzFair.sol': { content: src } },
    settings: {
      evmVersion: 'shanghai',
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } },
    },
  };
  const out = JSON.parse(solc.compile(JSON.stringify(input)));
  const errs = (out.errors || []).filter((e) => e.severity === 'error');
  if (errs.length) {
    console.error(errs.map((e) => e.formattedMessage).join('\n'));
    process.exit(1);
  }
  const c = out.contracts['BlitzFair.sol']['BlitzFair'];
  return { abi: c.abi, bytecode: '0x' + c.evm.bytecode.object };
}
