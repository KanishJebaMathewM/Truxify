// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Escrow System for Truxify
/// @notice Manages escrow deposits, releases, and refunds for bookings.
/// @dev Uses authorized relayers to trigger state changes.
contract Escrow {
    enum EscrowStatus {
        None,
        Funded,
        Released,
        Refunded
    }

    struct BookingEscrow {
        address payable customer;
        address payable driver;
        uint256 amount;
        EscrowStatus status;
    }

    address public owner;
    mapping(address => bool) public authorizedRelayers;
    mapping(bytes32 => BookingEscrow) public escrows;
    mapping(address => uint256) public pendingWithdrawals;
    bool private locked;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event Deposited(bytes32 indexed bookingId, address indexed customer, address indexed driver, uint256 amount);
    event Released(bytes32 indexed bookingId, address indexed driver, uint256 amount);
    event Refunded(bytes32 indexed bookingId, address indexed customer, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);

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

    /// @notice Initializes the contract and sets the initial relayer.
    /// @param initialRelayer Address of the first authorized relayer.
    constructor(address initialRelayer) {
        owner = msg.sender;
        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    /// @notice Adds or removes a relayer.
    /// @param relayer Address of the relayer.
    /// @param authorized Boolean indicating if they are authorized.
    function setRelayer(address relayer, bool authorized) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        authorizedRelayers[relayer] = authorized;
        emit RelayerUpdated(relayer, authorized);
    }

    /// @notice Deposits funds into escrow for a specific booking.
    /// @param bookingId The unique identifier of the booking.
    /// @param customer The address of the customer making the deposit.
    /// @param driver The address of the driver assigned to the booking.
    function deposit(bytes32 bookingId, address payable customer, address payable driver) external payable {
        require(bookingId != bytes32(0), "Invalid booking");
        require(customer != address(0), "Invalid customer");
        require(driver != address(0), "Invalid driver");
        require(msg.value > 0, "Deposit required");
        require(msg.sender == customer, "Only customer can deposit");
        require(escrows[bookingId].status == EscrowStatus.None, "Escrow exists");

        escrows[bookingId] = BookingEscrow({
            customer: customer,
            driver: driver,
            amount: msg.value,
            status: EscrowStatus.Funded
        });

        emit Deposited(bookingId, customer, driver, msg.value);
    }

    /// @notice Releases funds to the driver after a successful booking.
    /// @param bookingId The unique identifier of the booking.
    function releaseFunds(bytes32 bookingId) external onlyRelayer nonReentrant {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        booking.status = EscrowStatus.Released;
        uint256 amount = booking.amount;
        booking.amount = 0;

        pendingWithdrawals[booking.driver] += amount;

        emit Released(bookingId, booking.driver, amount);
    }

    /// @notice Refunds funds back to the customer if the booking is cancelled.
    /// @param bookingId The unique identifier of the booking.
    function refundFunds(bytes32 bookingId) external onlyRelayer nonReentrant {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        booking.status = EscrowStatus.Refunded;
        uint256 amount = booking.amount;
        booking.amount = 0;

        pendingWithdrawals[booking.customer] += amount;

        emit Refunded(bookingId, booking.customer, amount);
    }

    /// @notice Allows a user (driver or customer) to withdraw their pending funds.
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdrawal failed");

        emit Withdrawn(msg.sender, amount);
    }
}
