// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BlitzFairV2 · 链上公平秒杀分配器（女巫防御版）
/// @notice v2 相对 v1 新增两层女巫防御：
///         1) 保证金（bond）：每单提交时缴纳，揭示即退还，未揭示没收归发行方
///            → 批量小号有真实成本，订单 spam / 恶意占位被经济抑制；
///         2) 质押加权抽签（weighted）：中签权重正比于质押额（累积权重采样，无放回）
///            → 把质押拆成 N 个小号，总权重不变，女巫中性（splitting gains nothing）。
///         等概率模式（weighted=false）适合社区发售；质押模式适合高价值发售。
/// @dev 随机性仍来自区块字段（prevrandao + 前一块哈希），与 v1 相同的已知限制；
///      生产环境应升级为 VRF。加权抽签复杂度 O(k·n)，适合中小规模候选池。
contract BlitzFairV2 {
    // ============ 数据结构 ============
    struct Drop {
        address issuer;         // 发起方
        string  name;           // 场次名称
        uint256 quota;          // 名额
        uint256 price;          // 最低质押（wei，MON）
        uint256 bond;           // 每单保证金（wei，MON）
        uint64  commitDeadline; // 提交截止
        uint64  revealDeadline; // 揭示截止
        bool    weighted;       // 是否质押加权抽签
        bool    drawn;          // 是否已开奖
        uint256 committedCount;
        uint256 revealedCount;
        uint256 winners;        // 实际中签数 = min(quota, revealed)
        uint256 proceeds;       // 发行方可提 = 中签者质押 + 未揭示没收的保证金
    }

    uint256 public nextDropId;
    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => uint256)) public stakeOf;   // 每单质押额（加权权重）
    mapping(uint256 => mapping(address => bool)) public hasCommitted;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(address => bool)) public hasRefunded;
    mapping(uint256 => mapping(address => bool)) public isWinner;
    mapping(uint256 => address[]) public eligible;                    // 已揭示候选池

    // ============ 事件 ============
    event DropCreated(uint256 indexed dropId, address indexed issuer, string name,
        uint256 quota, uint256 price, uint256 bond, bool weighted,
        uint64 commitDeadline, uint64 revealDeadline);
    event Committed(uint256 indexed dropId, address indexed user, bytes32 commitment, uint256 stake);
    event Revealed(uint256 indexed dropId, address indexed user, uint256 bondRefunded);
    event Drawn(uint256 indexed dropId, uint256 winners, uint256 seed);
    event Refunded(uint256 indexed dropId, address indexed user, uint256 amount);
    event Swept(uint256 indexed dropId, address indexed issuer, uint256 amount);

    modifier dropExists(uint256 dropId) {
        require(dropId < nextDropId, "no such drop");
        _;
    }

    /// @notice 合约版本号（网页端据此区分 v1/v2 ABI）
    function version() external pure returns (uint256) { return 2; }

    // ============ 发行方：创建秒杀 ============
    function createDrop(
        string calldata name,
        uint256 quota,
        uint256 price,
        uint256 bond,
        uint64 commitSeconds,
        uint64 revealSeconds,
        bool weighted
    ) external returns (uint256 dropId) {
        require(quota > 0, "quota = 0");
        require(price > 0, "price = 0");
        require(commitSeconds >= 60 && revealSeconds >= 60, "window too short");

        dropId = nextDropId++;
        drops[dropId] = Drop({
            issuer: msg.sender,
            name: name,
            quota: quota,
            price: price,
            bond: bond,
            commitDeadline: uint64(block.timestamp) + commitSeconds,
            revealDeadline: uint64(block.timestamp) + commitSeconds + revealSeconds,
            weighted: weighted,
            drawn: false,
            committedCount: 0,
            revealedCount: 0,
            winners: 0,
            proceeds: 0
        });
        emit DropCreated(dropId, msg.sender, name, quota, price, bond, weighted,
            drops[dropId].commitDeadline, drops[dropId].revealDeadline);
    }

    /// @notice 客户端用它算 commitment：hashOf(dropId, myAddress, secret)
    function hashOf(uint256 dropId, address account, bytes32 secret) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(dropId, account, secret));
    }

    // ============ 买家：提交 → 揭示 ============
    /// @notice 提交阶段：缴纳质押 + 保证金，只交 hash，不暴露下单意图。
    ///         等概率模式要求质押恰好等于 price；加权模式允许质押 ≥ price（权重正比于质押）。
    function commit(uint256 dropId, bytes32 commitment) external payable dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(!d.drawn, "already drawn");
        require(block.timestamp < d.commitDeadline, "commit closed");
        require(!hasCommitted[dropId][msg.sender], "one order per address");
        require(msg.value >= d.price + d.bond, "underpaid");

        uint256 stake = msg.value - d.bond;
        if (!d.weighted) require(stake == d.price, "wrong price");

        hasCommitted[dropId][msg.sender] = true;
        commitmentOf[dropId][msg.sender] = commitment;
        stakeOf[dropId][msg.sender] = stake;
        d.committedCount += 1;
        emit Committed(dropId, msg.sender, commitment, stake);
    }

    /// @notice 揭示：校验 secret，并即时退还保证金（女巫防御第一层）
    function reveal(uint256 dropId, bytes32 secret) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(block.timestamp >= d.commitDeadline, "commit still open");
        require(block.timestamp < d.revealDeadline, "reveal closed");
        require(hasCommitted[dropId][msg.sender], "not committed");
        require(!hasRevealed[dropId][msg.sender], "already revealed");
        require(commitmentOf[dropId][msg.sender] == hashOf(dropId, msg.sender, secret), "bad secret");

        hasRevealed[dropId][msg.sender] = true;
        eligible[dropId].push(msg.sender);
        d.revealedCount += 1;
        emit Revealed(dropId, msg.sender, d.bond);
        if (d.bond > 0) {
            (bool ok, ) = msg.sender.call{value: d.bond}("");
            require(ok, "bond refund failed");
        }
    }

    // ============ 开奖（任何人都可触发）============
    function draw(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(!d.drawn, "already drawn");
        require(block.timestamp >= d.revealDeadline, "reveal still open");

        uint256 n = eligible[dropId].length;
        uint256 k = d.quota < n ? d.quota : n;

        uint256 seed = uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            blockhash(block.number - 1),
            dropId,
            n,
            address(this)
        )));

        uint256 winnersStakes = 0;
        if (k > 0) {
            winnersStakes = d.weighted
                ? _drawWeighted(dropId, n, k, seed)
                : _drawEqual(dropId, n, k, seed);
        }

        // 未揭示订单的保证金没收，归发行方（质押仍可退，见 claimRefund）
        d.drawn = true;
        d.winners = k;
        d.proceeds = winnersStakes + (d.committedCount - d.revealedCount) * d.bond;
        emit Drawn(dropId, k, seed);
    }

    /// @notice 等概率抽签：部分 Fisher–Yates，只洗前 k 个，O(k)
    function _drawEqual(uint256 dropId, uint256 n, uint256 k, uint256 seed)
        internal returns (uint256 winnersStakes)
    {
        address[] memory pool = eligible[dropId];
        for (uint256 i = 0; i < k; i++) {
            seed = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 j = i + (seed % (n - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
            isWinner[dropId][pool[i]] = true;
            winnersStakes += stakeOf[dropId][pool[i]];
        }
    }

    /// @notice 质押加权抽签：累积权重采样（无放回），权重正比于质押额。
    ///         拆分质押到多个小号不改变总权重 → 女巫中性。复杂度 O(k·n)。
    function _drawWeighted(uint256 dropId, uint256 n, uint256 k, uint256 seed)
        internal returns (uint256 winnersStakes)
    {
        uint256[] memory weights = new uint256[](n);
        uint256 totalWeight = 0;
        for (uint256 i = 0; i < n; i++) {
            weights[i] = stakeOf[dropId][eligible[dropId][i]];
            totalWeight += weights[i];
        }
        for (uint256 t = 0; t < k; t++) {
            seed = uint256(keccak256(abi.encodePacked(seed, t)));
            uint256 x = seed % totalWeight;
            uint256 cumulative = 0;
            for (uint256 i = 0; i < n; i++) {
                if (weights[i] == 0) continue;
                cumulative += weights[i];
                if (x < cumulative) {
                    address winner = eligible[dropId][i];
                    isWinner[dropId][winner] = true;
                    winnersStakes += weights[i];
                    totalWeight -= weights[i];
                    weights[i] = 0;
                    break;
                }
            }
        }
    }

    // ============ 退款 & 提款 ============
    /// @notice 未中奖者（已揭示或未揭示）退回质押；未揭示者的保证金已没收，不退。
    function claimRefund(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(d.drawn, "not drawn yet");
        require(hasCommitted[dropId][msg.sender], "not committed");
        require(!isWinner[dropId][msg.sender], "you won, no refund");
        require(!hasRefunded[dropId][msg.sender], "already refunded");

        uint256 amount = stakeOf[dropId][msg.sender];
        hasRefunded[dropId][msg.sender] = true; // effects 先于 interaction
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "refund failed");
        emit Refunded(dropId, msg.sender, amount);
    }

    /// @notice 发行方提走中签者质押 + 未揭示没收的保证金
    function sweep(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(d.drawn, "not drawn yet");
        require(msg.sender == d.issuer, "issuer only");
        uint256 amount = d.proceeds;
        require(amount > 0, "nothing to sweep");
        d.proceeds = 0;
        (bool ok, ) = msg.sender.call{value: amount}("");
        require(ok, "sweep failed");
        emit Swept(dropId, msg.sender, amount);
    }

    // ============ 视图 ============
    function getDrop(uint256 dropId) external view dropExists(dropId) returns (Drop memory) {
        return drops[dropId];
    }

    function eligibleCount(uint256 dropId) external view dropExists(dropId) returns (uint256) {
        return eligible[dropId].length;
    }

    function eligibleAt(uint256 dropId, uint256 index) external view dropExists(dropId) returns (address) {
        return eligible[dropId][index];
    }
}
