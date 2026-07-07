# Sample Hardhat 3 Project (`node:test` and `viem`)

This project showcases a Hardhat 3 project using the native Node.js test runner (`node:test`) and the `viem` library for Ethereum interactions.

To learn more about Hardhat 3, please visit the [Getting Started guide](https://hardhat.org/docs/getting-started#getting-started-with-hardhat-3). To share your feedback, join our [Hardhat 3](https://hardhat.org/hardhat3-telegram-group) Telegram group or [open an issue](https://github.com/NomicFoundation/hardhat/issues/new) in our GitHub issue tracker.

## Project Overview

This example project includes:

- A simple Hardhat configuration file.
- Foundry-compatible Solidity unit tests.
- TypeScript integration tests using [`node:test`](nodejs.org/api/test.html), the new Node.js native test runner, and [`viem`](https://viem.sh/).
- Examples demonstrating how to connect to different types of networks, including locally simulating OP mainnet.

## Usage

### Running Tests

To run all the tests in the project, execute the following command:

```shell
npx hardhat test
```

You can also selectively run the Solidity or `node:test` tests:

```shell
npx hardhat test solidity
npx hardhat test nodejs
```

### Make a deployment to Sepolia

This project includes an example Ignition module to deploy the contract. You can deploy this module to a locally simulated chain or to Sepolia.

To run the deployment to a local chain:

```shell
npx hardhat ignition deploy ignition/modules/Counter.ts
```

To run the deployment to Sepolia, you need an account with funds to send the transaction. The provided Hardhat configuration includes a Configuration Variable called `SEPOLIA_PRIVATE_KEY`, which you can use to set the private key of the account you want to use.

You can set the `SEPOLIA_PRIVATE_KEY` variable using the `hardhat-keystore` plugin or by setting it as an environment variable.

To set the `SEPOLIA_PRIVATE_KEY` config variable using `hardhat-keystore`:

```shell
npx hardhat keystore set SEPOLIA_PRIVATE_KEY
```

After setting the variable, you can run the deployment with the Sepolia network:

```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```

# Truxify Smart Contracts

## Security Architecture

### Re-entrancy Protection

All ETH-transferring functions implement two complementary defences:

**1. Checks-Effects-Interactions (CEI) Pattern**
State variables (`paid`, `amount`, `status`) are updated *before*
any external `.call{}()`. This means even if a re-entrant call occurs,
the state checks at the top of the function will already reflect
the completed payment and revert.

**2. OpenZeppelin `ReentrancyGuard`**
The `nonReentrant` modifier provides a mutex lock that explicitly
reverts any re-entrant call with `ReentrancyGuardReentrantCall`.

Functions protected: `releasePayment()`, `cancelBooking()`

### Running Tests

```bash
cd blockchain
npm install
npx hardhat test
```

### Static Analysis

```bash
pip install slither-analyzer
slither contracts/TruxifyEscrow.sol
```

## Contribution Guide

Welcome! If you're looking to contribute to the Truxify smart contracts, here's how to set up your local development environment.

### 1. Install Dependencies

Ensure you have Node.js installed, then install the dependencies in the `blockchain` directory:

```bash
cd blockchain
npm install
```

### 2. Run a Local Hardhat Node

To simulate the blockchain locally for testing and development, start the Hardhat network node. This will spin up a local Ethereum network and provide you with 20 funded test accounts.

```bash
npx hardhat node
```

Leave this terminal window open.

### 3. Deploy Contracts Locally

Open a **new terminal window** and deploy the smart contracts to your local node. By default, Hardhat scripts will connect to the local node if you specify the `--network localhost` flag.

```bash
cd blockchain
npx hardhat ignition deploy ignition/modules/Counter.ts --network localhost
```
*(Note: Replace `Counter.ts` with the appropriate escrow module if deploying the Truxify Escrow contract).*

### 4. Running Tests

Before submitting a Pull Request, ensure all tests pass:

```bash
npx hardhat test
```

### 5. Code Style & Formatting

We use Prettier for formatting. Ensure your Solidity code is formatted before committing:

```bash
npm run format
```

### 6. Submitting a Pull Request

- Fork the repository and create a new branch from `main`.
- Write tests for any new contract functionality.
- Ensure all tests and static analysis checks (`slither`) pass.
- Open a Pull Request detailing your changes.