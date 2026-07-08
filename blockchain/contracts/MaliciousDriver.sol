// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITruxifyEscrow {
    function releasePayment(uint256 bookingId) external;
    function withdraw() external;
}

/**
 * @dev Test-only contract that attempts re-entrant drain on withdraw.
 *      NOT deployed to production — used only in test suite.
 */
contract MaliciousDriver {
    ITruxifyEscrow public escrow;
    uint256 public attackBookingId;
    uint256 public attackCount;

    constructor(address escrowAddress) {
        escrow = ITruxifyEscrow(escrowAddress);
    }

    // Called when ETH is received — attempts re-entrant call to withdraw
    receive() external payable {
        attackCount++;
        if (attackCount < 5) {
            // Try to call withdraw again before first call is finished
            escrow.withdraw();
        }
    }

    function setAttackBookingId(uint256 bookingId) external {
        attackBookingId = bookingId;
    }

    function attackWithdraw() external {
        escrow.withdraw();
    }
}