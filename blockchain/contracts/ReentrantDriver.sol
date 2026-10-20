// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IEscrow {
    function releaseFunds(bytes32 bookingId) external;
}

/// @dev Test-only attack mock. The driver re-enters releaseFunds mid-payout;
///      Escrow's nonReentrant guard must make the re-entrant call fail, which
///      fails the payout transfer and reverts the outer release.
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

    function attackRelease(bytes32 targetBookingId) external {
        bookingId = targetBookingId;
        attackEnabled = true;
        escrow.releaseFunds(targetBookingId);
    }

    receive() external payable {
        if (attackEnabled) {
            attackEnabled = false;
            escrow.releaseFunds(bookingId);
        }
    }
}
