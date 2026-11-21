// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BlitzFair · 链上公平秒杀分配器
/// @notice commit → reveal → 单块批量随机分配。
///         先到先得的时代结束了：机器人抢跑没有意义，名额只看运气。
contract BlitzFair {
    // ============ 数据结构 ============
    struct Drop {
        address issuer;         // 发起方（品牌方/主办方）
        string  name;           // "演唱会门票 · 限量10张"
        uint256 quota;          // 名额
        uint256 price;          // 单价（wei，MON）
        uint64  commitDeadline; // 提交截止
        uint64  revealDeadline; // 揭示截止
        bool    drawn;          // 是否已开奖
        uint256 committedCount;
        uint256 revealedCount;
        uint256 winners;        // 实际中签数 = min(quota, revealed)
        uint256 proceeds;       // 发行方可提 = price * winners
    }

    uint256 public nextDropId;
    mapping(uint256 => Drop) public drops;
    mapping(uint256 => mapping(address => bytes32)) public commitmentOf;
    mapping(uint256 => mapping(address => bool)) public hasCommitted;
    mapping(uint256 => mapping(address => bool)) public hasRevealed;
    mapping(uint256 => mapping(address => bool)) public hasRefunded;
    mapping(uint256 => mapping(address => bool)) public isWinner;
    mapping(uint256 => address[]) public eligible;

    // ============ 事件 ============
    event DropCreated(uint256 indexed dropId, address indexed issuer, string name,
        uint256 quota, uint256 price, uint64 commitDeadline, uint64 revealDeadline);
    event Committed(uint256 indexed dropId, address indexed user, bytes32 commitment);
    event Revealed(uint256 indexed dropId, address indexed user);
    event Drawn(uint256 indexed dropId, uint256 winners, uint256 seed);
    event Refunded(uint256 indexed dropId, address indexed user, uint256 amount);
    event Swept(uint256 indexed dropId, address indexed issuer, uint256 amount);

    modifier dropExists(uint256 dropId) {
        require(dropId < nextDropId, "no such drop");
        _;
    }

    // ============ 发行方：创建秒杀 ============
    function createDrop(
        string calldata name,
        uint256 quota,
        uint256 price,
        uint64 commitSeconds,
        uint64 revealSeconds
    ) external returns (uint256 dropId) {
        require(quota > 0, "quota = 0");
        require(commitSeconds >= 60 && revealSeconds >= 60, "window too short");

        dropId = nextDropId++;
        drops[dropId] = Drop({
            issuer: msg.sender,
            name: name,
            quota: quota,
            price: price,
            commitDeadline: uint64(block.timestamp) + commitSeconds,
            revealDeadline: uint64(block.timestamp) + commitSeconds + revealSeconds,
            drawn: false,
            committedCount: 0,
            revealedCount: 0,
            winners: 0,
            proceeds: 0
        });
        emit DropCreated(dropId, msg.sender, name, quota, price,
            drops[dropId].commitDeadline, drops[dropId].revealDeadline);
    }

    /// @notice 客户端用它算 commitment：hashOf(dropId, myAddress, secret)
    function hashOf(uint256 dropId, address account, bytes32 secret) public pure returns (bytes32) {
        return keccak256(abi.encodePacked(dropId, account, secret));
    }

    // ============ 买家：提交 → 揭示 ============
    /// @notice 提交阶段：只交 hash，不暴露下单意图
    function commit(uint256 dropId, bytes32 commitment) external payable dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(!d.drawn, "already drawn");
        require(block.timestamp < d.commitDeadline, "commit closed");
        require(msg.value == d.price, "wrong price");
        require(!hasCommitted[dropId][msg.sender], "one order per address");

        hasCommitted[dropId][msg.sender] = true;
        commitmentOf[dropId][msg.sender] = commitment;
        d.committedCount += 1;
        emit Committed(dropId, msg.sender, commitment);
    }

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
        emit Revealed(dropId, msg.sender);
    }

    // ============ 开奖（任何人都可触发）============
    function draw(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(!d.drawn, "already drawn");
        require(block.timestamp >= d.revealDeadline, "reveal still open");

        uint256 n = eligible[dropId].length;
        uint256 k = d.quota < n ? d.quota : n;

        address[] memory pool = eligible[dropId];
        uint256 seed = uint256(keccak256(abi.encodePacked(
            block.prevrandao,
            blockhash(block.number - 1),
            dropId,
            n,
            address(this)
        )));

        // 部分 Fisher–Yates：只洗前 k 个，O(k)
        for (uint256 i = 0; i < k; i++) {
            seed = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 j = i + (seed % (n - i));
            (pool[i], pool[j]) = (pool[j], pool[i]);
            isWinner[dropId][pool[i]] = true;
        }

        d.drawn = true;
        d.winners = k;
        d.proceeds = d.price * k;
        emit Drawn(dropId, k, seed);
    }

    // ============ 退款 & 提款 ============
    /// @notice 未中奖者 / 未 reveal 者，全额原路退回
    function claimRefund(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(d.drawn, "not drawn yet");
        require(hasCommitted[dropId][msg.sender], "not committed");
        require(!isWinner[dropId][msg.sender], "you won, no refund");
        require(!hasRefunded[dropId][msg.sender], "already refunded");

        hasRefunded[dropId][msg.sender] = true; // effects 先于 interaction
        (bool ok, ) = msg.sender.call{value: d.price}("");
        require(ok, "refund failed");
        emit Refunded(dropId, msg.sender, d.price);
    }

    /// @notice 发行方提走中签者的货款
    function sweep(uint256 dropId) external dropExists(dropId) {
        Drop storage d = drops[dropId];
        require(d.drawn, "not drawn yet");
        require(msg.sender == d.issuer, "issuer only");
        uint256 amount = d.proceeds;
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
