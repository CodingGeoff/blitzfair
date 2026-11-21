#!/usr/bin/env node
/**
 * 演示发售填充脚本：为一场已创建的发售补上真实的候选订单。
 * 每次运行都会生成一次性测试钱包、资助它们、各自 commit，全部是真实链上交易。
 *
 * 用法：
 *   node scripts/fill-demo-drop.js fill   --drop 1 --accounts 12
 *   node scripts/fill-demo-drop.js reveal --drop 1
 *   node scripts/fill-demo-drop.js check  --drop 1
 *
 * 注意
 *  - 一次性测试钱包与 secret 只用于本地演示，写入 agent/demo-seed.json，
 *    该文件已在 .gitignore 中，不入库、不上链、不要提交。
 *  - 若演示用的地址被清空，重新跑一次 fill 即可。
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
const RPC = process.env.RPC || 'https://testnet-rpc.monad.xyz';
const CONTRACT = process.env.CONTRACT;
const SECRETS = path.join(__dirname, '..', 'agent', 'demo-seed.json');
const args = process.argv.slice(2);
const CMD = args[0] || 'check';
const opt = (n, d) => { const i = args.indexOf('--' + n); return i === -1 ? d : args[i + 1]; };
const DROP = BigInt(opt('drop', '0'));

const ABI = [
  'function hashOf(uint256,address,bytes32) view returns (bytes32)',
  'function commit(uint256,bytes32) payable',
  'function reveal(uint256,bytes32)',
  'function isWinner(uint256,address) view returns (bool)',
  'function getDrop(uint256) view returns (tuple(address issuer,string name,uint256 quota,uint256 price,uint64 commitDeadline,uint64 revealDeadline,bool drawn,uint256 committedCount,uint256 revealedCount,uint256 winners,uint256 proceeds))'
];

const provider = new ethers.JsonRpcProvider(RPC);
const main = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const readC = new ethers.Contract(CONTRACT, ABI, provider);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const txOpts = async () => {
  const fee = await provider.getFeeData();
  return fee.gasPrice ? { gasPrice: (fee.gasPrice * 7n) / 4n } : {};
};
const loadSec = () => { try { return JSON.parse(fs.readFileSync(SECRETS, 'utf8')); } catch { return {}; } };
const saveSec = s => fs.writeFileSync(SECRETS, JSON.stringify(s, null, 2), { mode: 0o600 });

(async () => {
  if (!CONTRACT) throw new Error('.env 缺少 CONTRACT');
  const d = await readC.getDrop(DROP);
  const price = d.price;
  console.log(`Drop #${DROP}「${d.name}」单价 ${ethers.formatEther(price)} MON · 已提交 ${d.committedCount} / 已揭示 ${d.revealedCount}`);

  if (CMD === 'fill') {
    const COUNT = parseInt(opt('accounts', process.env.DEMO_ACCOUNTS || '14'), 10);
    const incMain = opt('include-main', '0') === '1';
    const sec = loadSec(); const key = DROP.toString(); sec[key] = sec[key] || [];
    const mk = (label) => { const w = ethers.Wallet.createRandom(); return { label, address: w.address, privateKey: w.privateKey, secret: ethers.hexlify(ethers.randomBytes(32)) }; };
    const entries = [...Array(COUNT)].map((_, i) => mk(`account_${String(i + 1).padStart(2, '0')}`));
    if (incMain) entries.push({ label: 'issuer_wallet', address: main.address, privateKey: main.privateKey, secret: ethers.hexlify(ethers.randomBytes(32)) });

    console.log(`准备资助并提交 ${entries.length} 个候选地址…`);
    // Monad 测试网 gas ≈ 102 gwei，给 0.025 MON 足够走完整流程
    const withRetry = async (label, fn, tries = 4) => {
      let last;
      for (let i = 1; i <= tries; i++) {
        try { return await fn(); }
        catch (e) { last = e; const inner = e.info?.error?.message || e.shortMessage || e.message; console.log(`  …${label} 第${i}次失败：${String(inner).slice(0, 120)}，重试中`); await sleep(2500 * i); }
      }
      throw last;
    };
    for (const e of entries) {
      if (e.address !== main.address) {
        const bal = await provider.getBalance(e.address);
        if (bal < price + ethers.parseEther('0.02')) {
          await withRetry(e.label + ' 资助', async () => { const tx = await main.sendTransaction({ to: e.address, value: price + ethers.parseEther('0.025'), ...(await txOpts()) }); await tx.wait(); });
        }
      }
      const signer = e.address === main.address ? main : new ethers.Wallet(e.privateKey, provider);
      const c = new ethers.Contract(CONTRACT, ABI, signer);
      const hash = await readC.hashOf(DROP, e.address, e.secret);
      await withRetry(e.label + ' 提交', async () => { const tx = await c.commit(DROP, hash, { value: price, ...(await txOpts()) }); await tx.wait(); });
      console.log(`  ✅ ${e.label.padEnd(18)} ${e.address.slice(0, 10)}… 已提交`);
      sec[key].push(e); saveSec(sec);
      await sleep(800);  // 温柔限速，避免 RPC 429
    }
    console.log(`🎉 预置完成：本 drop 共 ${sec[key].length} 个候选订单（含之前）`);
  } else if (CMD === 'reveal') {
    const sec = loadSec(); const entries = sec[DROP.toString()] || [];
    if (!entries.length) throw new Error(`agent/demo-seed.json 里没有 Drop #${DROP} 的记录，先跑一次 fill`);
    for (const e of entries) {
      if (e.revealed) continue;
      const signer = e.address === main.address ? main : new ethers.Wallet(e.privateKey, provider);
      const c = new ethers.Contract(CONTRACT, ABI, signer);
      try {
        const tx = await c.reveal(DROP, e.secret, await txOpts());
        await tx.wait();
        e.revealed = true; saveSec(sec);
        console.log(`  ✅ ${e.label.padEnd(18)} 已揭示`);
      } catch (err) { console.log(`  ⚠️ ${e.label} 揭示失败：${err.shortMessage || err.message}`); }
    }
  } else if (CMD === 'check') {
    const sec = loadSec(); const entries = sec[DROP.toString()] || [];
    for (const e of entries) {
      const won = await readC.isWinner(DROP, e.address);
      console.log(`  ${won ? '🏆' : '  '} ${e.label.padEnd(18)} ${e.address.slice(0, 12)}… ${won ? '中签！' : ''}`);
    }
  }
})().catch(e => { console.error('❌', e.shortMessage || e.message || e); process.exit(1); });
