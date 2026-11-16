// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFreightAMM {
    function addLiquidity(uint256 amountA, uint256 amountB) external;
    function removeLiquidity(uint256 liquidity) external;
    function swapAForB(uint256 amountIn, uint256 minAmountOut, uint256 deadline) external;
    function liquidityBalances(address) external view returns (uint256);
}

interface IERC20 {
    function approve(address spender, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @dev Test-only attack mock for FreightAMM reentrancy tests (#11630).
contract MaliciousReceiver {
    IFreightAMM public amm;
    IERC20 public tokenA;
    IERC20 public tokenB;
    bool public attacking;

    constructor(address _amm, address _tokenA, address _tokenB) {
        amm = IFreightAMM(_amm);
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    function addLiquidityAndPrepareAttack(uint256 amountA, uint256 amountB) external {
        tokenA.approve(address(amm), amountA);
        tokenB.approve(address(amm), amountB);
        amm.addLiquidity(amountA, amountB);
    }

    function triggerReentrancyAttack() external {
        attacking = true;
        uint256 lpBalance = amm.liquidityBalances(address(this));
        amm.removeLiquidity(lpBalance);
    }

    function triggerSwapReentrancy(uint256 amount) external {
        attacking = true;
        tokenA.approve(address(amm), amount);
        amm.swapAForB(amount, 0, block.timestamp + 1000);
    }

    // Fallback to re-enter
    receive() external payable {
        if (attacking) {
            attacking = false; // Prevent infinite loop
            uint256 lpBalance = amm.liquidityBalances(address(this));
            if (lpBalance > 0) {
                amm.removeLiquidity(lpBalance);
            }
        }
    }
}
