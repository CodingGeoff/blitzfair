# ⚡ BlitzFair · 链上公平秒杀分配器

> 让抢茅台、球鞋和演唱会门票，不再属于黄牛。

**Commit → Reveal → 单块批量随机分配**。所有人同一时间窗口下注（只交哈希），窗口关闭后统一揭示，由链上随机数一次抽签产生中签名单。先到先得 = 0 公平；BlitzFair = 人人等概率，没人能用速度、gas 或机器人抢跑。

---

## 为什么非 Monad 不可

| 公平分配的需求 | Monad 给的答案 |
|---|---|
| 大家必须"同一时刻进、同一区块出" | 亚秒级出块 + 单块终局 |
| 全城抢购 / 全网 claim 的峰值并发 | 10,000 TPS 并行 EVM |
| 未中签者的退款必须便宜到可行 | gas 趋近于零（退一笔退款几分钱都嫌贵的问题不存在） |
| 抽签是"一次性大事件"，必须可信可验证 | prevrandao ⊕ blockhash 上链可验，全程链上可追溯 |

---

## 架构

```
买家 A ──commit(hash)──┐
买家 B ──commit(hash)──┤
  …                    ▼
              ┌─────────────────┐   reveal 窗口   ┌────────────────┐
              │   BlitzFair.sol  │ ──────────────▶ │ eligible[] 候选池 │
              │  一地址一单      │                 └───────┬────────┘
              │  price 托管      │                         │
              └─────────────────┘                         ▼
                     ▲                        draw()：prevrandao⊕blockhash
                     │                        部分 Fisher–Yates，O(quota)
        未中签 ← claimRefund()                     │
        中签者 ← 付款留给发行方 sweep()            ▼
                                          isWinner[] 上链，公开可查
```

## 目录

```
contracts/BlitzFair.sol   # 合约（已通过 solc 0.8.30 Shanghai 编译验证 ✅）
sim/simulate.js           # 「黄牛 vs 真人」双轮对比模拟器（零依赖，现场大屏用）
web/index.html            # 前端（ethers v6，连 Monad 测试网，真实 commit/reveal/退款）
```

---

## 5 分钟部署到 Monad 测试网

```bash
# 0. 装 Foundry（已有可跳过）
curl -L https://foundry.paradigm.xyz | bash && foundryup

# 1. 拿测试 MON：去 Monad 测试网 faucet（地址见现场 Monad 101 幻灯片 / docs.monad.xyz）

# 2. 配置环境变量
cp .env.example .env   # 填 PRIVATE_KEY（测试小号！）
source .env

# 3. 部署（无构造参数）
forge create contracts/BlitzFair.sol:BlitzFair \
  --rpc-url $RPC --private-key $PRIVATE_KEY --broadcast
# → 记下合约地址，填进 .env 的 CONTRACT，以及 web/index.html 顶部输入框

# 4. 创建一个 Drop（示例：限量 10 张、0.01 MON/张、提交窗 10 分钟、揭示窗 5 分钟）
cast send $CONTRACT \
  "createDrop(string,uint256,uint256,uint64,uint64)" \
  "演唱会门票·限量10张" 10 10000000000000000 600 300 \
  --rpc-url $RPC --private-key $PRIVATE_KEY

# 5. 查看 Drop #0
cast call $CONTRACT "getDrop(uint256)(address,string,uint256,uint256,uint64,uint64,bool,uint256,uint256,uint256,uint256)" 0 --rpc-url $RPC
```

### 买家侧流程（前端已封装，CLI 备用）

```bash
SECRET=0x$(openssl rand -hex 32)          # 生成 secret，务必保存！
ADDR=0x你的地址
HASH=$(cast call $CONTRACT "hashOf(uint256,address,bytes32)(bytes32)" 0 $ADDR $SECRET --rpc-url $RPC | awk '{print $1}')

cast send $CONTRACT "commit(uint256,bytes32)" 0 $HASH \
  --value 0.01ether --rpc-url $RPC --private-key $PRIVATE_KEY

# commit 窗口结束后：
cast send $CONTRACT "reveal(uint256,bytes32)" 0 $SECRET --rpc-url $RPC --private-key $PRIVATE_KEY

# reveal 窗口结束后（任何人都能触发开奖）：
cast send $CONTRACT "draw(uint256)" 0 --rpc-url $RPC --private-key $PRIVATE_KEY

# 没中签 → 退款（中签没有退款）：
cast send $CONTRACT "claimRefund(uint256)" 0 --rpc-url $RPC --private-key $PRIVATE_KEY
```

### 本地模拟演示（不连链也能讲）

```bash
node sim/simulate.js          # 完整演出（≈25 秒，--fast 跳过延迟）
node sim/simulate.js --bots 60 --humans 44 --quota 10 --seed 42
```

第 1 轮「先到先得」：10 个名额被黄牛 bot 全部拿下，真人 0；第 2 轮「BlitzFair」：随机抽签，真人 5、黄牛 5，人人 9.6% 等概率。现场大屏效果极强。

---

## 现场演示剧本（4 分钟版）

1. **痛点（30s）**：「上周抢演唱会门票，你是不是 0.01 秒被 bot 抢光了？黄牛的机器人比你快，不是因为它们强，是因为先到先得这个规则就有毒。」
2. **模拟（60s）**：跑 `node sim/simulate.js`——先到先得真人 0 张 vs BlitzFair 真人 5 张。
3. **真实链上（90s）**：前端连测试网 → commit（只交 hash）→ 窗口切换 → reveal → 点「开奖」→ 大屏查 `isWinner` / 一键退款。**全程真交易、真退款上链。**
4. **收尾（20s）**：「BlitzFair——让茅台、球鞋和门票，不再属于黄牛。今天是 Monad 上的第一个公平秒杀协议，明天它可以是任何限量发售的默认规则。谢谢！」

## 验收边界（诚实声明，评委很吃这套）

- ✅ 已验证：solc 0.8.30 编译通过；commit→reveal→draw→refund 全链路逻辑；模拟器与合约同构（部分 Fisher–Yates）
- ⚠️ 随机数：Demo 用 `prevrandao ⊕ blockhash`；生产级应接 **Pyth Entropy / Chainlink VRF**（防验证者小幅偏置）——*路线图*
- ⚠️ Sybil：一地址一单 + 等额资金托管提高作弊成本，但不能根除多地址；生产需接 World ID / Gitcoin Passport / 黑名单——*路线图*
- ⚠️ 仅在 Monad **测试网**演示，主网参数需安全审计后再上

## 赛后（拿完奖/没拿奖都值得做）

- 把它做成发售方的 SaaS：`createDrop` 一行 API + 结算对账 + 退款自动化（商业化：按 GMV 抽成 0.5%）
- 申请 **Rebel in Paradise Pro AI 黑客松（总奖金 $40k，赛道含「原生智能体支付 / 智能市场 / 智能体应用」，截止 2 月底，rebel.openbuild.xyz）**
- 主网上线 + 接 Pyth Entropy + 接一个真实发售方（球鞋/演出票/周边）做试点
