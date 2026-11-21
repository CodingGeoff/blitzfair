# 协作说明（给 AI Agent / 队友）

本仓库是「Monad Blitz@广州」参赛项目 **BlitzFair**（链上公平秒杀分配器）。
改动代码前先读 `README.md` 的「验收范围」一节：那里列了已验证的部分和已知限制。

- 合约：`contracts/BlitzFair.sol`（Foundry，`forge test` 前需 `forge install foundry-rs/forge-std`）
- 网页端：`docs/index.html`（纯静态单文件，ethers 随仓库托管，可直接双击打开）
- 一键复现整场发售：`npm install && npm run demo`（需要 `.env` 里的测试钱包私钥）
- 环境变量见 `.env.example`；`.env`、`.mojo/`、`agent/*.json` 均在 `.gitignore` 内，**不要提交**

<!-- mojo:start -->
## MOJO 参赛提醒（由 MOJO skills 维护，勿手改）
- 活动：「Monad Blitz@广州」（eventId=18）
- 提交截止：2026-11-21 18:00（北京时间，UTC+8；ISO：2026-11-21T18:00:00+08:00）
- 活动类型：hackathon；加速阈值：剩余 ≤ 2 小时；冻结阈值：剩余 ≤ 30 分钟
- 每次开始工作先用系统时间算剩余时长，并告诉用户还剩多少。
- 剩余 ≤ 加速阈值：停止开新功能，优先让现有成果可运行、可演示，准备截图与项目描述。
- 剩余 ≤ 冻结阈值：先查项目是否已提交；没提交就立刻提交现有成果，已提交只做必要更新。
- 已过截止时间：删除本提醒块（AGENTS.md 与 CLAUDE.md 都删）。
- 怎么查、怎么提交：装了 MOJO skills 就用 mojo-submit；没装就读取 https://mojo.devnads.com/api/agent/instructions/18/skill.md 照做。凭证在 .mojo/agent.json。
<!-- mojo:end -->
