// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FreightAMM
 * @dev Automated Market Maker for freight liquidity pools.
 * @notice Implements constant product formula (x * y = k) for token swaps.
 * 
 * SECURITY FIXES (Issue #11630):
 * 1. Added ReentrancyGuard to prevent recursive calls during token transfers.
 * 2. Enforced Checks-Effects-Interactions pattern in removeLiquidity (state updates before transfers).
 * 3. Added slippage protection (minAmountOut) and deadline validation to swap functions.
 */
contract FreightAMM is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public tokenA;
    IERC20 public tokenB;
    
    uint256 public reserveA;
    uint256 public reserveB;
    
    uint256 public totalLiquidity;
    mapping(address => uint256) public liquidityBalances;
    
    uint256 public constant FEE_BPS = 30; // 0.3% fee
    
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event LiquidityRemoved(address indexed provider, uint256 amountA, uint256 amountB, uint256 liquidity);
    event Swap(address indexed user, address tokenIn, uint256 amountIn, address tokenOut, uint256 amountOut);

    constructor(address _tokenA, address _tokenB) Ownable(msg.sender) {
        require(_tokenA != address(0) && _tokenB != address(0), "Invalid token addresses");
        require(_tokenA != _tokenB, "Tokens must be different");
        tokenA = IERC20(_tokenA);
        tokenB = IERC20(_tokenB);
    }

    /**
     * @dev Adds liquidity to the pool.
     * @param amountA Amount of tokenA to add
     * @param amountB Amount of tokenB to add
     */
    function addLiquidity(uint256 amountA, uint256 amountB) external nonReentrant {
        require(amountA > 0 && amountB > 0, "Amounts must be > 0");
        
        tokenA.safeTransferFrom(msg.sender, address(this), amountA);
        tokenB.safeTransferFrom(msg.sender, address(this), amountB);
        
        uint256 liquidity;
        if (totalLiquidity == 0) {
            liquidity = sqrt(amountA * amountB);
        } else {
            liquidity = min(
                (amountA * totalLiquidity) / reserveA,
                (amountB * totalLiquidity) / reserveB
            );
        }
        
        require(liquidity > 0, "Insufficient liquidity minted");
        
        // Effects
        liquidityBalances[msg.sender] += liquidity;
        totalLiquidity += liquidity;
        reserveA += amountA;
        reserveB += amountB;
        
        emit LiquidityAdded(msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @dev Removes liquidity from the pool.
     * SECURITY FIX: State updates (Effects) happen BEFORE external transfers (Interactions)
     * to prevent reentrancy attacks. Protected by nonReentrant modifier.
     * @param liquidity Amount of LP tokens to burn
     */
    function removeLiquidity(uint256 liquidity) external nonReentrant {
        require(liquidity > 0, "Insufficient liquidity");
        require(liquidityBalances[msg.sender] >= liquidity, "Insufficient balance");
        
        uint256 amountA = (liquidity * reserveA) / totalLiquidity;
        uint256 amountB = (liquidity * reserveB) / totalLiquidity;
        
        require(amountA > 0 && amountB > 0, "Insufficient output amounts");
        
        // EFFECTS: Update state BEFORE external calls
        liquidityBalances[msg.sender] -= liquidity;
        totalLiquidity -= liquidity;
        reserveA -= amountA;
        reserveB -= amountB;
        
        // INTERACTIONS: Transfer tokens out
        tokenA.safeTransfer(msg.sender, amountA);
        tokenB.safeTransfer(msg.sender, amountB);
        
        emit LiquidityRemoved(msg.sender, amountA, amountB, liquidity);
    }

    /**
     * @dev Swaps tokenA for tokenB.
     * SECURITY FIX: Added minAmountOut for slippage protection and deadline to prevent stale transactions.
     * @param amountIn Amount of tokenA to swap
     * @param minAmountOut Minimum acceptable amount of tokenB (slippage protection)
     * @param deadline Unix timestamp after which the transaction reverts
     */
    function swapAForB(
        uint256 amountIn, 
        uint256 minAmountOut, 
        uint256 deadline
    ) external nonReentrant {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Insufficient input amount");
        
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveB;
        uint256 denominator = (reserveA * 10000) + amountInWithFee;
        uint256 amountOut = numerator / denominator;
        
        require(amountOut >= minAmountOut, "Slippage tolerance exceeded");
        require(amountOut < reserveB, "Insufficient liquidity");
        
        // Effects
        reserveA += amountIn;
        reserveB -= amountOut;
        
        // Interactions
        tokenA.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenB.safeTransfer(msg.sender, amountOut);
        
        emit Swap(msg.sender, address(tokenA), amountIn, address(tokenB), amountOut);
    }

    /**
     * @dev Swaps tokenB for tokenA.
     * SECURITY FIX: Added minAmountOut for slippage protection and deadline to prevent stale transactions.
     * @param amountIn Amount of tokenB to swap
     * @param minAmountOut Minimum acceptable amount of tokenA (slippage protection)
     * @param deadline Unix timestamp after which the transaction reverts
     */
    function swapBForA(
        uint256 amountIn, 
        uint256 minAmountOut, 
        uint256 deadline
    ) external nonReentrant {
        require(block.timestamp <= deadline, "Transaction expired");
        require(amountIn > 0, "Insufficient input amount");
        
        uint256 amountInWithFee = amountIn * (10000 - FEE_BPS);
        uint256 numerator = amountInWithFee * reserveA;
        uint256 denominator = (reserveB * 10000) + amountInWithFee;
        uint256 amountOut = numerator / denominator;
        
        require(amountOut >= minAmountOut, "Slippage tolerance exceeded");
        require(amountOut < reserveA, "Insufficient liquidity");
        
        // Effects
        reserveB += amountIn;
        reserveA -= amountOut;
        
        // Interactions
        tokenB.safeTransferFrom(msg.sender, address(this), amountIn);
        tokenA.safeTransfer(msg.sender, amountOut);
        
        emit Swap(msg.sender, address(tokenB), amountIn, address(tokenA), amountOut);
    }

    // Helper math functions
    function sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function min(uint256 x, uint256 y) internal pure returns (uint256) {
        return x < y ? x : y;
    }
}
