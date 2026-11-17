
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

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

    bool private locked;

    event OwnershipTransferred(
        address indexed previousOwner,
        address indexed newOwner
    );

    event RelayerUpdated(
        address indexed relayer,
        bool authorized
    );

    event Deposited(
        bytes32 indexed bookingId,
        address indexed customer,
        address indexed driver,
        uint256 amount
    );

    event Released(
        bytes32 indexed bookingId,
        address indexed driver,
        uint256 amount
    );

    event Refunded(
        bytes32 indexed bookingId,
        address indexed customer,
        uint256 amount
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyRelayer() {
        require(
            authorizedRelayers[msg.sender],
            "Not authorized relayer"
        );
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

        emit OwnershipTransferred(address(0), msg.sender);

        if (initialRelayer != address(0)) {
            authorizedRelayers[initialRelayer] = true;
            emit RelayerUpdated(initialRelayer, true);
        }
    }

    // Transfer contract ownership
    function transferOwnership(address newOwner)
        external
        onlyOwner
    {
        require(newOwner != address(0), "Invalid owner");
        require(newOwner != owner, "Already owner");

        address previousOwner = owner;
        owner = newOwner;

        emit OwnershipTransferred(previousOwner, newOwner);
    }

    // Authorize or revoke relayers
    function setRelayer(
        address relayer,
        bool authorized
    ) external onlyOwner {
        require(relayer != address(0), "Invalid relayer");
        require(
            authorizedRelayers[relayer] != authorized,
            "No change"
        );

        authorizedRelayers[relayer] = authorized;

        emit RelayerUpdated(relayer, authorized);
    }

    // Deposit funds into escrow
    function deposit(
        bytes32 bookingId,
        address payable customer,
        address payable driver
    ) external payable {
        require(bookingId != bytes32(0), "Invalid booking");
        require(customer != address(0), "Invalid customer");
        require(driver != address(0), "Invalid driver");
        require(msg.value > 0, "Deposit required");

        require(
            msg.sender == customer ||
            authorizedRelayers[msg.sender] ||
            msg.sender == owner,
            "Not authorized to deposit"
        );

        require(
            escrows[bookingId].status == EscrowStatus.None,
            "Escrow exists"
        );

        escrows[bookingId] = BookingEscrow({
            customer: customer,
            driver: driver,
            amount: msg.value,
            status: EscrowStatus.Funded
        });

        emit Deposited(
            bookingId,
            customer,
            driver,
            msg.value
        );
    }

    // Release payment to driver
    function releaseFunds(bytes32 bookingId)
        external
        onlyRelayer
        nonReentrant
    {
        BookingEscrow storage booking = escrows[bookingId];

        require(
            booking.status == EscrowStatus.Funded,
            "Escrow not funded"
        );

        uint256 amount = booking.amount;
        address payable driver = booking.driver;

        require(amount > 0, "Invalid amount");
        require(driver != address(0), "Invalid driver");

        booking.status = EscrowStatus.Released;
        booking.amount = 0;

        (bool sent, ) = driver.call{value: amount}("");

        require(sent, "Driver payout failed");

        emit Released(bookingId, driver, amount);
    }

    // Refund payment to customer
    function refundFunds(bytes32 bookingId)
        external
        onlyRelayer
        nonReentrant
    {
        BookingEscrow storage booking = escrows[bookingId];

        require(
            booking.status == EscrowStatus.Funded,
            "Escrow not funded"
        );

        uint256 amount = booking.amount;
        address payable customer = booking.customer;

        require(amount > 0, "Invalid amount");
        require(customer != address(0), "Invalid customer");

        booking.status = EscrowStatus.Refunded;
        booking.amount = 0;

        (bool sent, ) = customer.call{value: amount}("");

        require(sent, "Customer refund failed");

        emit Refunded(bookingId, customer, amount);
    }
}
