// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Pausable.sol";

/// @title Escrow System for Truxify (DEPRECATED)
/// @notice ⚠️ THIS CONTRACT IS DEPRECATED. Do NOT deploy or reference it.
///
///   Active contract: TruxifyEscrow.sol (in contracts/)
///   Reason for deprecation:
///     - Incompatible ABI (bytes32 bookingId, relayer pattern)
///     - Missing OpenZeppelin security standards (ReentrancyGuard, Ownable, Pausable)
///     - The backend ABI (escrow.js) targets TruxifyEscrow.sol exclusively
///
///   If ESCROW_CONTRACT_ADDRESS points to this contract, ALL blockchain
///   operations will silently fail because the function selectors do not match.
///
/// @dev Retained only for historical reference. Deployed instances should
///      be migrated to TruxifyEscrow.sol before any further development.
contract Escrow is Pausable {
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
    mapping(address => uint256) public releaseTimestamps;
    bool private locked;
    uint256 public constant WITHDRAWAL_TIMEOUT = 30 days;

    event RelayerUpdated(address indexed relayer, bool authorized);
    event Deposited(bytes32 indexed bookingId, address indexed customer, address indexed driver, uint256 amount);
    event Released(bytes32 indexed bookingId, address indexed driver, uint256 amount);
    event Refunded(bytes32 indexed bookingId, address indexed customer, uint256 amount);
    event Withdrawn(address indexed recipient, uint256 amount);
    event EmergencyRecovered(address indexed recipient, uint256 amount);

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

    /// @notice Pauses the contract, preventing all deposits, releases, and refunds.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpauses the contract.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Deposits funds into escrow for a specific booking.
    /// @param bookingId The unique identifier of the booking.
    /// @param customer The address of the customer making the deposit.
    /// @param driver The address of the driver assigned to the booking.
    function deposit(bytes32 bookingId, address payable customer, address payable driver) external payable whenNotPaused {
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
    function releaseFunds(bytes32 bookingId) external onlyRelayer nonReentrant whenNotPaused {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        uint256 amount = booking.amount;
        address driver = booking.driver;
        booking.status = EscrowStatus.Released;
        booking.amount = 0;

        pendingWithdrawals[driver] += amount;
        releaseTimestamps[driver] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit Released(bookingId, driver, amount);
    }

    /// @notice Refunds funds back to the customer if the booking is cancelled.
    /// @param bookingId The unique identifier of the booking.
    function refundFunds(bytes32 bookingId) external onlyRelayer nonReentrant whenNotPaused {
        BookingEscrow storage booking = escrows[bookingId];
        require(booking.status == EscrowStatus.Funded, "Escrow not funded");

        uint256 amount = booking.amount;
        address customer = booking.customer;
        booking.status = EscrowStatus.Refunded;
        booking.amount = 0;

        pendingWithdrawals[customer] += amount;
        releaseTimestamps[customer] = block.timestamp + WITHDRAWAL_TIMEOUT;

        emit Refunded(bookingId, customer, amount);
    }

    /// @notice Allows a user (driver or customer) to withdraw their pending funds.
    function withdraw() external nonReentrant whenNotPaused {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "Nothing to withdraw");

        pendingWithdrawals[msg.sender] = 0;
        releaseTimestamps[msg.sender] = 0;

        (bool sent, ) = msg.sender.call{value: amount}("");
        require(sent, "Withdrawal failed");

        emit Withdrawn(msg.sender, amount);
    }

    /// @notice Emergency recovery function for owner to recover funds after timeout.
    /// @dev Can only be called after the withdrawal timeout period has passed.
    /// @param recipient The address to receive the recovered funds
    /// @param amount The amount to recover
    function emergencyRecover(address recipient, uint256 amount) external onlyOwner nonReentrant {
        require(recipient != address(0), "Invalid recipient");
        require(block.timestamp > releaseTimestamps[recipient], "Withdrawal period active");
        require(pendingWithdrawals[recipient] >= amount, "Insufficient pending");

        pendingWithdrawals[recipient] -= amount;
        releaseTimestamps[recipient] = 0;

        (bool sent, ) = recipient.call{value: amount}("");
        require(sent, "Emergency transfer failed");

        emit EmergencyRecovered(recipient, amount);
    }
}
