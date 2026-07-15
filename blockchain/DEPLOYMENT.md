# Deployment Guide — Truxify Contracts

## Overview

This document describes how to deploy the `TruxifyEscrow` and `Reputation` smart contracts and configure the backend to use them.

## Contracts

| Contract | File | Solidity | Constructor Args |
|----------|------|----------|-----------------|
| TruxifyEscrow | `contracts/TruxifyEscrow.sol` | `^0.8.20` | None (Ownable uses msg.sender) |
| Reputation | `contracts/Reputation.sol` | `^0.8.24` | `address initialRelayer` |

**Dependencies**: OpenZeppelin (ReentrancyGuard, Ownable, Pausable)

## Prerequisites

```bash
cd blockchain
npm install
```

## Deployment Steps

### 1. Set Environment Variables

```bash
export POLYGON_RPC_URL=https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY
export RELAYER_PRIVATE_KEY=0xYourDeployerPrivateKey
```

> **Note**: The config also accepts `DEPLOYER_PRIVATE_KEY` as a fallback. Never commit private keys.

### 2. Deploy Using Hardhat Ignition (Recommended)

```bash
cd blockchain
npx hardhat ignition deploy ignition/modules/TruxifyEscrow.ts --network amoy
```

This deploys both `TruxifyEscrow` and `Reputation` in a single Ignition execution.

### 3. Deploy Using Standalone Script (Alternative)

```bash
cd blockchain
npx hardhat run scripts/deploy.js --network amoy
```

### 4. Record the Deployed Addresses

After deployment, note the contract addresses and set them in the backend `.env`:

```env
ESCROW_CONTRACT_ADDRESS=0xTruxifyEscrowAddress
REPUTATION_CONTRACT_ADDRESS=0xReputationAddress
```

## Per-Network Addresses

| Network | TruxifyEscrow | Reputation | Deploy Date | Notes |
|---------|--------------|------------|-------------|-------|
| Amoy (testnet) | TBD | TBD | — | Development |
| Polygon mainnet | TBD | TBD | — | Production |

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
