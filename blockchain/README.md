# Truxify Blockchain Infrastructure

This directory contains the smart contracts, tests, and deployment scripts for the Truxify decentralized reputation and escrow system.

## Setup & Compilation

### 1. Install Dependencies
Navigate to the blockchain directory and install the required packages:
```bash
cd blockchain
npm install
```

### 2. Environment Configuration
Create a `.env` file from the provided `.env.example`:
```bash
cp .env.example .env
```
Fill in the following variables:
- `POLYGON_RPC_URL`: JSON-RPC URL for Polygon (e.g., via Alchemy, Infura, or public RPC).
- `DEPLOYER_PRIVATE_KEY`: Private key of the deployer wallet (do not share this!).
- `POLYGONSCAN_API_KEY`: API key from Polygonscan to enable contract source code verification.
- `RELAYER_WALLET_ADDRESS`: (Optional) Custom wallet address of the initial relayer. Defaults to the deployer's address if not specified.

### 3. Compile Contracts
Compile the Solidity smart contracts:
```bash
npx hardhat compile
```

## Running Tests
To run the local unit tests (uses Hardhat Network):
```bash
npm test
```

## Deployment

To deploy the Escrow and Reputation contracts to a network:

### Local Development Network
```bash
npx hardhat run scripts/deploy.js --network hardhat
```

### Polygon Amoy Testnet
```bash
npx hardhat run scripts/deploy.js --network amoy
```

### Polygon Mainnet
```bash
npx hardhat run scripts/deploy.js --network polygon
```

The script will output the deployed addresses:
```text
Escrow deployed to: 0x...
Reputation deployed to: 0x...
```

## Contract Verification
To verify the contracts on Polygonscan:

```bash
# Verify Escrow (requires constructor argument: relayer address)
npx hardhat verify --network amoy <ESCROW_CONTRACT_ADDRESS> <RELAYER_WALLET_ADDRESS>

# Verify Reputation (requires constructor argument: relayer address)
npx hardhat verify --network amoy <REPUTATION_CONTRACT_ADDRESS> <RELAYER_WALLET_ADDRESS>
```
