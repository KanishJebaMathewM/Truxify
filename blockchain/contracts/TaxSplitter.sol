// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title TaxSplitter
 * @dev Splitter Smart Contract routing dynamic state tax percentages (GST/TDS) on payout distribution.
 */
contract TaxSplitter is Ownable {

    /// @dev Payout ids that have already been settled. Guards against a payer
    /// replaying the same logical payout (e.g. retrying after an RPC timeout).
    mapping(bytes32 => bool) public processedPayouts;

    event TaxDeducted(bytes32 indexed payoutId, address indexed driver, uint256 gstAmount, uint256 tdsAmount, uint256 netPayout);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Calculates and executes payout splits.
     * Enforces dynamic GST and TDS tax allocations.
     */
    function splitPayout(
        bytes32 _payoutId,
        address _driver,
        address _taxAuthorityWallet,
        uint256 _totalAmount,
        uint256 _gstRatePct,
        uint256 _tdsRatePct
    ) external payable returns (uint256 netPayout) {
        require(!processedPayouts[_payoutId], "Payout already processed");
        require(_totalAmount > 0, "Total amount must be > 0");
        require(msg.value >= _totalAmount, "Insufficient value sent for tax split");
        require(_gstRatePct + _tdsRatePct <= 100, "Tax rates exceed 100%");

        uint256 gstAmount = (_totalAmount * _gstRatePct) / 100;
        uint256 tdsAmount = (_totalAmount * _tdsRatePct) / 100;
        netPayout = _totalAmount - gstAmount - tdsAmount;

        // Checks-effects-interactions: mark the payout settled before any
        // external call, so a reentrant call with the same id cannot pay twice.
        processedPayouts[_payoutId] = true;

        // Route tax to government authority wallet
        (bool taxSent, ) = _taxAuthorityWallet.call{value: gstAmount + tdsAmount}("");
        require(taxSent, "Tax routing failed");

        // Route net payout to driver wallet
        (bool driverSent, ) = _driver.call{value: netPayout}("");
        require(driverSent, "Driver payout failed");

        // Refund any excess ETH sent beyond the total amount so it is not
        // permanently trapped in the contract.
        if (msg.value > _totalAmount) {
            (bool refunded, ) = payable(msg.sender).call{value: msg.value - _totalAmount}("");
            require(refunded, "Excess refund failed");
        }

        emit TaxDeducted(_payoutId, _driver, gstAmount, tdsAmount, netPayout);
    }
}
