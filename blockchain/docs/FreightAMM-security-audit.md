# FreightAMM Security Audit & Fixes (Issue #11630)

## Executive Summary
A security audit of the `FreightAMM.sol` smart contract revealed critical vulnerabilities in the liquidity withdrawal and token swap functions. These issues exposed the protocol to reentrancy attacks and MEV (Miner Extractable Value) sandwich attacks. This document details the vulnerabilities and the implemented fixes.

## Vulnerability 1: Reentrancy in `removeLiquidity`

### Description
The original implementation of `removeLiquidity` executed external ERC20 token transfers (`tokenA.transfer`, `tokenB.transfer`) **before** updating the internal state (`liquidityBalances`, `reserveA`, `reserveB`). 

This violated the **Checks-Effects-Interactions** pattern. If a malicious contract called `removeLiquidity` and implemented a fallback/receive function that recursively called `removeLiquidity` again, it could drain the pool's tokens before its internal balance was decremented.

### Fix Implemented
1. **State Updates First**: The internal accounting variables (`liquidityBalances[msg.sender]`, `totalLiquidity`, `reserveA`, `reserveB`) are now updated **before** any external `safeTransfer` calls.
2. **ReentrancyGuard**: Inherited OpenZeppelin's `ReentrancyGuard` and applied the `nonReentrant` modifier to `removeLiquidity`, `addLiquidity`, `swapAForB`, and `swapBForA`. This ensures that even if state updates were somehow bypassed, the function cannot be re-entered.

```solidity
// EFFECTS: Update state BEFORE external calls
liquidityBalances[msg.sender] -= liquidity;
totalLiquidity -= liquidity;
reserveA -= amountA;
reserveB -= amountB;

// INTERACTIONS: Transfer tokens out
tokenA.safeTransfer(msg.sender, amountA);
tokenB.safeTransfer(msg.sender, amountB);
```

## Vulnerability 2: Missing Slippage Protection in Swaps

### Description
The `swapAForB` and `swapBForA` functions lacked a `minAmountOut` parameter. This meant users were forced to accept whatever output amount the AMM calculated at the exact moment of execution. 

In a high-volatility environment, or when targeted by a **sandwich attack** (where a bot front-runs the user's trade to skew the pool ratio, then back-runs to profit), the user would receive significantly fewer tokens than expected.

### Fix Implemented
Added `minAmountOut` (uint256) to both swap functions. The contract now calculates the expected output and explicitly checks:
```solidity
require(amountOut >= minAmountOut, "Slippage tolerance exceeded");
```
If the actual output is lower than the user's acceptable threshold (due to slippage or an attack), the transaction reverts, protecting the user's funds.

## Vulnerability 3: Missing Transaction Deadline

### Description
Transactions submitted to the mempool could be held by miners/validators and executed much later than intended, potentially at a highly unfavorable price.

### Fix Implemented
Added a `deadline` (uint256) parameter to swap functions. The contract validates:
```solidity
require(block.timestamp <= deadline, "Transaction expired");
```
This ensures that if a transaction is not included in a block within the user's specified time window, it automatically reverts.

## Testing
Comprehensive test suites have been added in `blockchain/test/`:
- `FreightAMM.reentrancy.test.js`: Deploys a malicious receiver contract that attempts to recursively drain liquidity. Verifies that `ReentrancyGuard` successfully blocks the attack.
- `FreightAMM.slippage.test.js`: Simulates sandwich attacks and verifies that `minAmountOut` correctly reverts unfavorable trades. Tests deadline expiration logic.

## Conclusion
With these fixes, `FreightAMM.sol` now adheres to industry-standard security practices for DeFi protocols. The Checks-Effects-Interactions pattern and OpenZeppelin guards eliminate reentrancy vectors, while slippage and deadline parameters protect users from MEV exploitation.
