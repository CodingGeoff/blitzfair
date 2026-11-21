#!/usr/bin/env node
/** 部署 BlitzFair 到 Monad 测试网：node scripts/deploy.js */
'use strict';
const fs = require('fs'); const path = require('path');
const solc = require('solc'); const { ethers } = require('ethers');
const envPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(envPath)) for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) { const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim(); }
const src = fs.readFileSync(path.join(__dirname, '..', 'contracts', 'BlitzFair.sol'), 'utf8');
const input = { language: 'Solidity', sources: { 'BlitzFair.sol': { content: src } },
  settings: { evmVersion: 'shanghai', optimizer: { enabled: true, runs: 200 }, viaIR: true, outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } };
const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter(e => e.severity === 'error');
if (errs.length) { console.error(errs.map(e => e.formattedMessage).join('\n')); process.exit(1); }
const c = out.contracts['BlitzFair.sol']['BlitzFair'];
const provider = new ethers.JsonRpcProvider(process.env.RPC || 'https://testnet-rpc.monad.xyz');
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
(async () => {
  console.log('部署账户：', wallet.address, '· 余额', ethers.formatEther(await provider.getBalance(wallet.address)), 'MON');
  const factory = new ethers.ContractFactory(c.abi, '0x' + c.evm.bytecode.object, wallet);
  const contract = await factory.deploy();
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log('✅ BlitzFair 已部署：', addr);
  console.log('   查看：https://testnet.monadvision.com/address/' + addr);
  fs.appendFileSync(envPath, `CONTRACT=${addr}\n`);
})().catch(e => { console.error('❌', e.shortMessage || e.message || e); process.exit(1); });
