# Deployment Guide — TruxifyEscrow

## Overview

This document describes how to deploy the `TruxifyEscrow` smart contract and configure the backend to use it.

## Contract

- **File**: `contracts/TruxifyEscrow.sol`
- **Compiler**: Solidity `^0.8.20`
- **Dependencies**: OpenZeppelin (ReentrancyGuard, Ownable, Pausable)

## Deployment Steps

### 1. Set Environment Variables

```bash
export POLYGON_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
export PRIVATE_KEY=your_deployer_wallet_private_key
```

### 2. Deploy Using Hardhat Ignition

```bash
cd blockchain
npx hardhat ignition deploy ignition/modules/TruxifyEscrow.ts --network amoy
```

Or using the standalone deploy script:

```bash
cd blockchain
RELAYER_WALLET_ADDRESS=0xYourRelayerAddress node scripts/deploy.js
```

### 3. Record the Deployed Address

After deployment, note the contract address and set it in the backend `.env`:

```env
ESCROW_CONTRACT_ADDRESS=0xDeployedContractAddress
```

## Per-Network Addresses

| Network | Contract Address | Deploy Date | Notes |
|---------|-----------------|-------------|-------|
| Amoy (testnet) | TBD | — | Development |
| Polygon mainnet | TBD | — | Production |

## Startup Verification

The backend (`escrow.js`) performs the following checks at startup when all env vars are set:

1. **`provider.getCode(address)`** — Verifies that bytecode exists at the configured address. If the result is `0x`, the contract is not deployed.
2. **`eth_call` test** — Calls `bookings(0)` as a read-only probe. If the call fails, the contract does not implement the expected ABI.

If either check fails, the backend sets `escrowContract = null` and logs an error, preventing silent escrow failures.

## Expected ABI Selectors

The backend expects these function selectors to be present on the deployed contract:

```
createBooking(uint256,address)   → 0xcf5ba53f
releasePayment(uint256)          → 0x2d8e4a0b
cancelBooking(uint256)           → 0x66b71f1c
bookings(uint256)                → 0xdc97d7d3
```

You can verify a deployed contract using:

```bash
cast keccak "createBooking(uint256,address)" | head -c 10
# → 0xcf5ba53f
```
