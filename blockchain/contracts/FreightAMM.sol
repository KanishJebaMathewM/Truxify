// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @title FreightAMM
 * @dev Constant Product (x * y = k) Automated Market Maker (AMM) Liquidity Pool swap contract.
 */
contract FreightAMM is Ownable {

    IERC20 public creditToken;
    IERC20 public stablecoinToken;

    uint256 public reserveCredit;
    uint256 public reserveStable;

    event Swapped(address indexed user, uint256 amountIn, uint256 amountOut, bool isCreditToStable);
    event LiquidityAdded(address indexed provider, uint256 creditAmount, uint256 stableAmount);

    constructor(address _creditAddress, address _stableAddress) Ownable(msg.sender) {
        creditToken = IERC20(_creditAddress);
        stablecoinToken = IERC20(_stableAddress);
    }

    /**
     * @dev Simple constant product swap execution: (x + dx)(y - dy) = k
     */
    function swap(uint256 _amountIn, bool _isCreditToStable) external returns (uint256 amountOut) {
        require(_amountIn > 0, "Swap amount must be > 0");

        if (_isCreditToStable) {
            require(creditToken.transferFrom(msg.sender, address(this), _amountIn), "Transfer failed");
            
            // Constant product equation evaluation: dy = (y * dx) / (x + dx)
            amountOut = (reserveStable * _amountIn) / (reserveCredit + _amountIn);
            require(stablecoinToken.transfer(msg.sender, amountOut), "Payout transfer failed");
            
            reserveCredit += _amountIn;
            reserveStable -= amountOut;
        } else {
            require(stablecoinToken.transferFrom(msg.sender, address(this), _amountIn), "Transfer failed");
            
            amountOut = (reserveCredit * _amountIn) / (reserveStable + _amountIn);
            require(creditToken.transfer(msg.sender, amountOut), "Payout transfer failed");
            
            reserveStable += _amountIn;
            reserveCredit -= amountOut;
        }

        emit Swapped(msg.sender, _amountIn, amountOut, _isCreditToStable);
    }

    function addLiquidity(uint256 _creditAmount, uint256 _stableAmount) external onlyOwner {
        require(creditToken.transferFrom(msg.sender, address(this), _creditAmount), "Credit transfer failed");
        require(stablecoinToken.transferFrom(msg.sender, address(this), _stableAmount), "Stable transfer failed");

        reserveCredit += _creditAmount;
        reserveStable += _stableAmount;

        emit LiquidityAdded(msg.sender, _creditAmount, _stableAmount);
    }
}
