// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FreightAMM
 * @dev Constant Product (x * y = k) Automated Market Maker (AMM) Liquidity Pool swap contract.
 */
contract FreightAMM is Ownable, ReentrancyGuard {

    IERC20 public creditToken;
    IERC20 public stablecoinToken;

    uint256 public reserveCredit;
    uint256 public reserveStable;

    uint256 public swapFeeBps = 30;

    event Swapped(address indexed user, uint256 amountIn, uint256 amountOut, bool isCreditToStable);
    event LiquidityAdded(address indexed provider, uint256 creditAmount, uint256 stableAmount);
    event SwapFeeUpdated(uint256 swapFeeBps);

    constructor(address _creditAddress, address _stableAddress) Ownable(msg.sender) {
        creditToken = IERC20(_creditAddress);
        stablecoinToken = IERC20(_stableAddress);
    }

    /**
     * @dev Simple constant product swap execution: (x + dx)(y - dy) = k
     */
    function swap(uint256 _amountIn, bool _isCreditToStable, uint256 _minAmountOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        require(_amountIn > 0, "Swap amount must be > 0");
        require(reserveCredit > 0 && reserveStable > 0, "Pool not seeded");

        // Fee is charged on the input amount and kept in the pool reserve so
        // it is collected rather than truncated away.
        uint256 feeAmount = (_amountIn * swapFeeBps) / 10000;
        uint256 amountInNet = _amountIn - feeAmount;

        if (_isCreditToStable) {
            require(creditToken.transferFrom(msg.sender, address(this), _amountIn), "Transfer failed");
            
            // Constant product equation evaluation: dy = (y * dx) / (x + dx)
            amountOut = (reserveStable * amountInNet) / (reserveCredit + _amountIn);
            require(amountOut >= _minAmountOut, "Swap output below minAmountOut");

            reserveCredit += _amountIn;
            reserveStable -= amountOut;

            require(stablecoinToken.transfer(msg.sender, amountOut), "Payout transfer failed");
        } else {
            require(stablecoinToken.transferFrom(msg.sender, address(this), _amountIn), "Transfer failed");
            
            amountOut = (reserveCredit * amountInNet) / (reserveStable + _amountIn);
            require(amountOut >= _minAmountOut, "Swap output below minAmountOut");

            reserveStable += _amountIn;
            reserveCredit -= amountOut;

            require(creditToken.transfer(msg.sender, amountOut), "Payout transfer failed");
        }

        emit Swapped(msg.sender, _amountIn, amountOut, _isCreditToStable);
    }

    function setSwapFeeBps(uint256 _swapFeeBps) external onlyOwner {
        require(_swapFeeBps <= 10000, "Swap fee exceeds 100%");
        swapFeeBps = _swapFeeBps;
        emit SwapFeeUpdated(_swapFeeBps);
    }

    function addLiquidity(uint256 _creditAmount, uint256 _stableAmount) external onlyOwner {
        require(creditToken.transferFrom(msg.sender, address(this), _creditAmount), "Credit transfer failed");
        require(stablecoinToken.transferFrom(msg.sender, address(this), _stableAmount), "Stable transfer failed");

        reserveCredit += _creditAmount;
        reserveStable += _stableAmount;

        emit LiquidityAdded(msg.sender, _creditAmount, _stableAmount);
    }
}
