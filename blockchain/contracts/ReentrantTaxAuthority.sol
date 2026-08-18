// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITaxSplitter {
    function splitPayout(
        bytes32 _payoutId,
        address _driver,
        address _taxAuthorityWallet,
        uint256 _totalAmount,
        uint256 _gstRatePct,
        uint256 _tdsRatePct
    ) external payable returns (uint256);
}

/// @notice Test-only tax authority wallet that re-enters TaxSplitter.splitPayout
///         with the same payout id while the original call is still mid-flight.
///         Never used in production deployments.
contract ReentrantTaxAuthority {
    ITaxSplitter public splitter;
    address public driver;
    bytes32 public payoutId;
    bool public attackEnabled;
    bool public reentrySucceeded;

    constructor(address splitterAddress) {
        splitter = ITaxSplitter(splitterAddress);
    }

    /// @dev Arms the attack and funds the contract for the re-entrant payout.
    function arm(bytes32 targetPayoutId, address targetDriver) external payable {
        payoutId = targetPayoutId;
        driver = targetDriver;
        attackEnabled = true;
    }

    receive() external payable {
        if (!attackEnabled) {
            return;
        }
        attackEnabled = false;

        // Re-enter with the same payout id. The result is swallowed rather than
        // bubbled so the outer payout is not reverted by the failed attempt --
        // the test asserts on `reentrySucceeded` instead.
        (bool ok, ) = address(splitter).call{value: 0.1 ether}(
            abi.encodeWithSelector(
                ITaxSplitter.splitPayout.selector,
                payoutId,
                driver,
                address(this),
                0.1 ether,
                uint256(12),
                uint256(1)
            )
        );
        reentrySucceeded = ok;
    }
}
