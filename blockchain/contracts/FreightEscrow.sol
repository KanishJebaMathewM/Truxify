// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title FreightEscrow
 * @notice Milestone-based smart escrow contract on Polygon supporting gasless EIP-712 meta-transactions.
 * @dev Allows shippers and truck drivers to execute milestone releases without holding native MATIC tokens.
 */
contract FreightEscrow {
    enum EscrowStatus { None, Funded, Completed, Refunded, Disputed }

    struct Milestone {
        uint8 id;               // 1 = Loading Advance, 2 = Transit Waypoint, 3 = Delivery Balance
        uint256 amount;         // Amount allocated to milestone
        bool isReleased;
    }

    struct BookingEscrow {
        address payable shipper;
        address payable driver;
        uint256 totalAmount;
        uint256 releasedAmount;
        EscrowStatus status;
        mapping(uint8 => Milestone) milestones;
    }

    address public owner;
    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => BookingEscrow) public escrows;
    mapping(address => uint256) public nonces; // EIP-712 Replay protection nonces
    bool private locked;

    // EIP-712 Constants
    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant RELEASE_MILESTONE_TYPEHASH = keccak256(
        "ReleaseMilestoneMetaTx(bytes32 bookingId,uint8 milestoneId,uint256 amount,uint256 nonce,uint256 deadline)"
    );

    // Events
    event RelayerUpdated(address indexed relayer, bool authorized);
    event Deposited(bytes32 indexed bookingId, address indexed shipper, address indexed driver, uint256 amount);
    event MilestoneReleased(bytes32 indexed bookingId, uint8 milestoneId, address indexed driver, uint256 amount);
    event Refunded(bytes32 indexed bookingId, address indexed shipper, uint256 amount);
    event Disputed(bytes32 indexed bookingId, address indexed sender, string reason);

    modifier onlyOwner() {
        require(msg.sender == owner, "FreightEscrow: caller is not owner");
        _;
    }

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender] || msg.sender == owner, "FreightEscrow: unauthorized relayer");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "FreightEscrow: reentrant call");
        locked = true;
        _;
        locked = false;
    }

    constructor(address initialRelayer) {
        owner = msg.sender;
        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("TruxifyFreightEscrow")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "FreightEscrow: invalid relayer address");
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    /**
     * @notice Deposits freight funds into escrow for a specific booking.
     */
    function deposit(bytes32 bookingId, address payable driver) external payable nonReentrant {
        require(msg.value > 0, "FreightEscrow: zero deposit");
        require(driver != address(0), "FreightEscrow: invalid driver");
        BookingEscrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.None, "FreightEscrow: escrow already exists");

        e.shipper = payable(msg.sender);
        e.driver = driver;
        e.totalAmount = msg.value;
        e.releasedAmount = 0;
        e.status = EscrowStatus.Funded;

        emit Deposited(bookingId, msg.sender, driver, msg.value);
    }

    /**
     * @notice Releases a milestone directly by the shipper.
     */
    function releaseMilestone(bytes32 bookingId, uint8 milestoneId, uint256 amount) external nonReentrant {
        BookingEscrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Funded, "FreightEscrow: escrow not active");
        require(msg.sender == e.shipper, "FreightEscrow: only shipper can release");
        _executeMilestoneRelease(e, bookingId, milestoneId, amount);
    }

    /**
     * @notice Gasless milestone release executed by an authorized relayer with shipper's EIP-712 signature.
     */
    function releaseMilestoneMetaTx(
        bytes32 bookingId,
        uint8 milestoneId,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external onlyRelayer nonReentrant {
        require(block.timestamp <= deadline, "FreightEscrow: meta-tx deadline expired");

        BookingEscrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Funded, "FreightEscrow: escrow not active");
        require(nonce == nonces[e.shipper], "FreightEscrow: invalid nonce");

        // Verify EIP-712 typed signature
        bytes32 structHash = keccak256(
            abi.encode(RELEASE_MILESTONE_TYPEHASH, bookingId, milestoneId, amount, nonce, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        address signer = _recoverSigner(digest, signature);

        require(signer == e.shipper, "FreightEscrow: invalid EIP-712 signature");

        // Increment replay protection nonce
        nonces[e.shipper]++;

        _executeMilestoneRelease(e, bookingId, milestoneId, amount);
    }

    function _executeMilestoneRelease(
        BookingEscrow storage e,
        bytes32 bookingId,
        uint8 milestoneId,
        uint256 amount
    ) internal {
        require(amount > 0, "FreightEscrow: zero amount");
        require(e.releasedAmount + amount <= e.totalAmount, "FreightEscrow: amount exceeds escrow balance");

        Milestone storage m = e.milestones[milestoneId];
        require(!m.isReleased, "FreightEscrow: milestone already released");

        m.id = milestoneId;
        m.amount = amount;
        m.isReleased = true;
        e.releasedAmount += amount;

        if (e.releasedAmount == e.totalAmount) {
            e.status = EscrowStatus.Completed;
        }

        (bool sent, ) = e.driver.call{value: amount}("");
        require(sent, "FreightEscrow: payout transfer failed");

        emit MilestoneReleased(bookingId, milestoneId, e.driver, amount);
    }

    /**
     * @notice Refunds remaining escrow balance back to shipper if trip is cancelled before milestones release.
     */
    function refund(bytes32 bookingId) external nonReentrant {
        BookingEscrow storage e = escrows[bookingId];
        require(e.status == EscrowStatus.Funded, "FreightEscrow: cannot refund");
        require(msg.sender == e.shipper || msg.sender == owner, "FreightEscrow: unauthorized refund");

        uint256 remaining = e.totalAmount - e.releasedAmount;
        require(remaining > 0, "FreightEscrow: no remaining funds");

        e.status = EscrowStatus.Refunded;
        (bool sent, ) = e.shipper.call{value: remaining}("");
        require(sent, "FreightEscrow: refund transfer failed");

        emit Refunded(bookingId, e.shipper, remaining);
    }

    function _recoverSigner(bytes32 digest, bytes memory sig) internal pure returns (address) {
        require(sig.length == 65, "FreightEscrow: invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) {
            v += 27;
        }
        return ecrecover(digest, v, r, s);
    }
}
