# ⚡ BlitzFair · 公平抢票

> 把抢票从**速度竞赛**换成**公开抽签**。
> Commit → Reveal → 链上抽签，一地址一单、足额托管、未中签自助全额退款。
> 抽签消除的是速度优势；资金优势它不消除——看到第「已知限制」一节。

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

## 为什么放在 Monad（照实写）

先把话说清楚：**抽签本身不需要特殊性能。** 提交窗口设成十分钟，任何 EVM 链上谁先谁后都不影响抽签结果。所以"300 毫秒出块"不是这个机制的前提，写进卖点里会被当场问穿。

链上真正多出来的一环只有两个：

1. **名单和开奖结果发行方改不了** —— 托管、抽签、开奖全部在同一个合约里，发行方没有留票的口子。
2. **退款不经过平台账户** —— 未中签者直接从合约取回，不依赖平台是否愿意退、什么时候退。

至于"为什么是 Monad 而不是 Base/Arbitrum"，我们的答案是**一条链上跑完提交、开奖、退款，中间不落到任何平台账户，而且每一步的成本都低到可以每场发售都这么做**。高峰期不排队、退款足够便宜这两点 Monad 成立，Base/Arbitrum 也成立；差别不在"能不能"，而在我们选择在 Monad 上把这三步做成一个原子闭环，并用它的 300ms 出块把"同一个开售窗口"压到秒级体验（这一点是体验优化，不是机制前提）。

## 和往届两个项目的关系

| 项目 | 它解决的问题 | 与我们的区别 |
|---|---|---|
| [去中心化抢票平台](https://mojo.devnads.com/projects/96)（Monad Blitz@深圳 V2，第 17 名） | 抢票，合约原子校验开场时间、余量、单地址限购，通过后铸 NFT 门票 | 本质仍是**先到先得**；我们把"购买资格"本身换成等概率抽签 |
| [Monad Blitz — 链上可信抽奖平台](https://mojo.devnads.com/projects/403)（惠州） | 线下抽奖主办方单方控名单，合约托管押金 + 链上随机开奖 | 它在**防止主办方作弊**；我们在**防止脚本抢跑**。它的筹码是押金，我们的筹码是购买资格与足额货款 |

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
node sim/sidebyside.js              # 同屏双轮：同一批订单，左边先到先得 / 右边抽签
node sim/sybil-sim.js               # 女巫攻击的数量级：地址数 → 中签率 / 资金占用 / 净收益
node sim/simulate.js                # 单人视角的完整流程模拟（不连链）
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

- **随机源**：当前基于 `prevrandao ⊕ blockhash`，**出块者可以挑选区块字段**，不含验证者级偏置防护。生产版本必须接入 [Pyth Entropy](https://docs.pyth.network/entropy) 或 Chainlink VRF —— *路线图*
- **女巫抵抗（重要）**：一地址一单 + 足额托管只是把**速度优势换成了资金优势**。有钱的脚本开一百个地址，仍然按比例中签。我们**不声称"杜绝黄牛"**，只声称"消除速度优势"。数量级见 `npm run sim:sybil`：1 个名额、票面 0.01 MON 时，100 个地址需要先备 1 MON，期望净收益仍是正的。缓解方向是三层叠加——一地址一单 + 按场次热度提高押金 + 发行方可控的身份/白名单层——三层都不在合约内核里
- **仅测试网**：主网参数需要先做安全审计
- **额度**：`quota` 越大，开奖交易的 Gas 越高；超大额度需要改为分批结算

## 已知边界演示

```bash
npm run sim:sybil     # 打印"多开地址仍按比例中签"的三张表
npm run sim:side     # 同一批订单跑两种规则，结果并排
```

这两条是**主动展示弱点**，不是装饰：抽签能消除速度优势，但消除不了资金优势，我们把它量化出来而不是藏起来。

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
