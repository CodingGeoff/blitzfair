# ⚡ BlitzFair · 链上公平秒杀分配器

> 限量发售的规则，从「谁最快」改成「人人等概率」。
> Commit → Reveal → 单块抽签，一地址一单、足额托管、未中签一键全额退款。

| 两分钟自证 | 位置 |
|---|---|
| 公开仓库 | https://github.com/CodingGeoff/blitzfair |
| 网页端（GitHub Pages，无需安装） | https://codinggeoff.github.io/blitzfair/ |
| 合约（Monad 测试网 10143） | `0x3c7C1a994b2046b4bfaEC46AC2309B20c1D6825e` |
| 源码验证 | Sourcify：creation **match** / runtime **match** · [查看](https://repo.sourcify.dev/10143/0x3c7C1a994b2046b4bfaEC46AC2309B20c1D6825e) |
| 一条命令复现整场发售 | `npm install && npm run demo` |

> 测试网原型：使用测试币，无真实价值，未审计，不构成任何投资建议。
> 合约源码已通过 Sourcify 校验（creation 与 runtime 均为 match），可对照仓库内 `contracts/BlitzFair.sol` 逐行复核。

---

## 它解决什么问题

限量发售的三个环节里，**「谁有资格买」这一环被速度垄断了**：抢购脚本可以在开售 1 毫秒内把所有名额打光，普通用户再多也无济于事。加验证码、限购都只是抬高门槛，规则本身仍然是「快者得」。

BlitzFair 把这一环的规则从「速度」改成「等概率」：

1. **提交（commit）** — 开售窗口内，每个人只提交一个订单哈希，金额足额托管。谁先谁后不影响任何结果。
2. **揭示（reveal）** — 窗口关闭后统一公开校验，一人一单。
3. **抽签（draw）** — 一次随机洗牌（部分 Fisher–Yates，复杂度 O(配额)）决定中签名单，结果上链可查。
4. **结算** — 中签者货款归发行方（`sweep`），未中签者一键全额退回（`claimRefund`）。

**先到先得 = 0 公平；BlitzFair = 每个人中签概率相同，速度、gas、网络都不再是变量。**

## 为什么需要 Monad

| 机制需求 | 为什么普通 L1 做不到 | Monad 提供 |
|---|---|---|
| 所有人必须「同时进、同块出」 | 12 秒出块里，最后几毫秒的交易能影响抽签 | 300 ms 出块 · 600 ms 单块终局 |
| 全城抢购的瞬时并发 | 高峰期交易排队、失败率高 | 10,000 TPS 并行执行 |
| 未中签者的退款必须便宜到可以无脑点 | 退款 Gas 比货值还贵就没人退 | 冷/热存储按页计价，退款成本极低 |
| 抽签过程必须可独立复核 | 中心化抽签无法自证 | 名单、种子、结果全部上链 |

> 参考：[Monad 与以太坊的差异](https://docs.monad.xyz/developer-essentials/differences)

---

## 架构

```
买家 A ──commit(hash)──┐
买家 B ──commit(hash)──┤
  …                    ▼
              ┌─────────────────┐   reveal 窗口   ┌──────────────────┐
              │   BlitzFair.sol  │ ──────────────▶ │ eligible[] 候选池 │
              │  一地址一单       │                 └────────┬─────────┘
              │  货款足额托管     │                          │
              └─────────────────┘                          ▼
                     ▲                       draw()：prevrandao ⊕ blockhash
                     │                       部分 Fisher–Yates，O(quota)
        未中签 ← claimRefund()                          │
        中签者货款 ← 发行方 sweep()                       ▼
                                            isWinner[] 上链，公开可查
```

## 功能一览

| 模块 | 说明 |
|---|---|
| **合约** | `contracts/BlitzFair.sol` — commit / reveal / draw / claimRefund / sweep，无构造参数 |
| **网页端** | `docs/index.html` — 单文件，ethers v6，连接钱包即可走完整个流程；含发行方对账面板 |
| **发售方对账** | 实时链上数据：已提交 / 已揭示 / 中签 / 待退款 / 应收货款，一键 `sweep` |
| **助手 Agent** | `agent/blitzfair-agent.js` — `watch` 全自动守场（下单 → 揭示 → 开奖 → 退款），`chat` 支持中文口令；不接大模型也能用规则引擎 |
| **模拟器** | `sim/simulate.js` — 零依赖，「先到先得 vs commit-reveal」双轮对比，适合现场大屏 |
| **本地全流程** | `scripts/local-demo.js` — 一条命令自动生成一次性测试账户并跑完整场发售 |

## 目录

```
contracts/BlitzFair.sol      # 合约（solc 0.8.30 / Shanghai / viaIR）
docs/index.html              # 网页端（GitHub Pages 直接托管此目录）
agent/blitzfair-agent.js     # 助手 Agent
sim/simulate.js              # 双轮对比模拟器
scripts/deploy.js            # 部署
scripts/local-demo.js        # 本地自动演示（生成测试账户 → 全流程）
foundry.toml
.env.example
```

---

## 快速开始

### 1) 网页端（最省事）

打开 https://codinggeoff.github.io/blitzfair/ → 点「切换到 Monad 测试网」→ 连接钱包 → 按步骤走。
没有测试币就去 [faucet.monad.xyz](https://faucet.monad.xyz) 领。

页面是纯静态单文件，ethers 随仓库托管、不依赖任何外部 CDN，所以也可以直接双击 `docs/index.html` 离线打开。

### 2) 本地跑一遍完整流程

```bash
npm install
cp .env.example .env      # 填入测试钱包 PRIVATE_KEY（一次性钱包！）

node scripts/local-demo.js          # 自动建场 → 15 个测试账户下单 → 揭示 → 开奖 → 退款
node sim/simulate.js                # 只看模拟器（不连链，25 秒）
```

### 3) 自己部署一套

```bash
# 部署（无构造参数）
forge create contracts/BlitzFair.sol:BlitzFair \
  --rpc-url $RPC --private-key $PRIVATE_KEY --broadcast

# 建一场：限量 10 张、0.01 MON/张、提交窗 10 分钟、揭示窗 5 分钟
cast send $CONTRACT "createDrop(string,uint256,uint256,uint64,uint64)" \
  "演示发售·限量10张" 10 10000000000000000 600 300 \
  --rpc-url $RPC --private-key $PRIVATE_KEY
```

### 4) 买家侧命令行（不想开网页时）

```bash
SECRET=0x$(openssl rand -hex 32)     # 生成后务必保存
HASH=$(cast call $CONTRACT "hashOf(uint256,address,bytes32)(bytes32)" 0 $ADDR $SECRET --rpc-url $RPC)

cast send $CONTRACT "commit(uint256,bytes32)" 0 $HASH --value 0.01ether --rpc-url $RPC --private-key $PRIVATE_KEY
cast send $CONTRACT "reveal(uint256,bytes32)" 0 $SECRET --rpc-url $RPC --private-key $PRIVATE_KEY
cast send $CONTRACT "draw(uint256)" 0 --rpc-url $RPC --private-key $PRIVATE_KEY      # 任何人都能触发
cast send $CONTRACT "claimRefund(uint256)" 0 --rpc-url $RPC --private-key $PRIVATE_KEY  # 未中签
```

---

## 验收范围（诚实声明）

**已验证**

- solc 0.8.30 编译通过；`commit → reveal → draw → refund → sweep` 全链路在测试网真实跑通
- 模拟器与合约同构（同一套部分 Fisher–Yates 逻辑）
- 边界用例：空池开奖归零、未揭示者不进入候选池、未中签者可全额退款、重复提交被拒

**已知限制**

- **随机源**：当前基于 `prevrandao ⊕ blockhash`，不含验证者级偏置防护。生产版本应接入 [Pyth Entropy](https://docs.pyth.network/entropy) 或 Chainlink VRF —— *路线图*
- **女巫抵抗**：一地址一单 + 足额托管把作弊成本抬高到「持仓成本 × 地址数」，但不能根除多地址。生产版本需要身份层（如 World ID / 信誉凭证 / 发行方白名单）—— *路线图*
- **仅测试网**：主网参数需要先做安全审计
- **额度**：`quota` 越大，开奖交易的 Gas 越高；超大额度需要改为分批结算

## 路线图

- [ ] 接入 Pyth Entropy 作为可切换随机源
- [ ] 女巫抵抗层（可选的身份/信誉插件）
- [ ] 面向发行方的 SaaS：`createDrop` 一行 API + 结算对账 + 退款自动化（按成交额抽成）
- [ ] 主网上线 + 与真实发行方试点
- [ ] 开奖策略可插拔（持仓加权 / 贡献加权 / 地域配额）

## 技术栈

Solidity 0.8.30 · Foundry · ethers v6 · Monad Testnet (10143) · Node.js

## 许可证

MIT
