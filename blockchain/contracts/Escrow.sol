// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Escrow {
    enum EscrowStatus {
        None,
        Funded,
        Released,
        Refunded,
        Disputed
    }

    struct BookingEscrow {
        address payable customer;
        address payable driver;
        uint256 amount;
        EscrowStatus status;
        uint256 disputeTimestamp;
    }

    address public owner;
    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => BookingEscrow) public escrows;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => uint256) public releaseTimestamps;
    uint256 public constant WITHDRAWAL_TIMEOUT = 30 days;
    uint256 public constant DISPUTE_TIMELOCK = 7 days;
    uint256 public constant TIMELOCK_DURATION = 7 days;
    bool private locked;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event Deposited(bytes32 indexed bookingId, address indexed customer, address indexed driver, uint256 amount);
    event Released(bytes32 indexed bookingId, address indexed driver, uint256 amount);
    event Refunded(bytes32 indexed bookingId, address indexed customer, uint256 amount);
    event Disputed(bytes32 indexed bookingId, address indexed participant);
    event DisputeRefunded(bytes32 indexed bookingId, address indexed customer, uint256 amount);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyRelayer() {
        require(authorizedRelayers[msg.sender], "Not authorized relayer");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
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
    }

    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    function deposit(bytes32 bookingId, address payable customer, address payable driver) external payable {
        require(msg.sender == customer, "Only customer can deposit");
        require(bookingId != bytes32(0), "Invalid booking");
        require(customer != address(0), "Invalid customer");
        require(driver != address(0), "Invalid driver");
        require(msg.value > 0, "Deposit required");
        require(escrows[bookingId].status == EscrowStatus.None, "Escrow exists");

        escrows[bookingId] = BookingEscrow({
            customer: customer,
            driver: driver,
            amount: msg.value,
            status: EscrowStatus.Funded,
            disputeTimestamp: 0
        });

        emit Deposited(bookingId, customer, driver, msg.value);
    }

    function raiseDispute(bytes32 bookingId) external {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");
        require(msg.sender == booking.customer || msg.sender == booking.driver, "Not escrow participant");

        booking.status = EscrowStatus.Disputed;
        booking.disputeTimestamp = block.timestamp;

        emit Disputed(bookingId, msg.sender);
    }

    function releaseFunds(bytes32 bookingId) external onlyRelayer nonReentrant {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        booking.status = EscrowStatus.Released;
        uint256 amount = booking.amount;
        booking.amount = 0;

        pendingWithdrawals[booking.driver] += amount;
        releaseTimestamps[booking.driver] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit Released(bookingId, booking.driver, amount);
    }

    function refundFunds(bytes32 bookingId) external onlyRelayer nonReentrant {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        booking.status = EscrowStatus.Refunded;
        uint256 amount = booking.amount;
        booking.amount = 0;

        pendingWithdrawals[booking.customer] += amount;
        releaseTimestamps[booking.customer] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit Refunded(bookingId, booking.customer, amount);
    }

    function refundAfterDisputeTimeout(bytes32 bookingId) external nonReentrant {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Disputed, "Dispute not active");
        require(booking.disputeTimestamp != 0, "No dispute timestamp");
        require(block.timestamp > booking.disputeTimestamp + TIMELOCK_DURATION, "Dispute timeout not reached");

        uint256 amount = booking.amount;
        require(amount > 0, "Nothing to refund");

        booking.status = EscrowStatus.Refunded;
        booking.amount = 0;
        booking.disputeTimestamp = 0;

        (bool sent, ) = booking.customer.call{value: amount}("");
        require(sent, "Customer refund failed");

        emit DisputeRefunded(bookingId, booking.customer, amount);
        emit Refunded(bookingId, booking.customer, amount);
    }

    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        releaseTimestamps[msg.sender] = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdrawal failed");
    }
}
