# Blockchain Architecture & Testnet Deployment

Truxify utilizes Polygon for trustless payment escrow, document integrity checks, and driver reputation records.

## 1. Prerequisites
- Node.js >= 22.x
- Testnet MATIC (Polygon Amoy testnet)
- Alchemy / Infura Polygon Amoy RPC URL

## 2. Environment Setup
Create `blockchain/.env` with the following variables:

```env
POLYGON_AMOY_RPC_URL=[https://rpc-amoy.polygon.technology](https://rpc-amoy.polygon.technology)
PRIVATE_KEY=your_wallet_private_key
POLYGONSCAN_API_KEY=your_polygonscan_api_key
cd blockchain
npm install
npx hardhat test
cd blockchain
npx hardhat run scripts/deploy.js --network amoy
