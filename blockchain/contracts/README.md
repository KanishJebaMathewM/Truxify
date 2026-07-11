# Smart Contracts

## Active Contract

| Contract | File | Status |
|----------|------|--------|
| **TruxifyEscrow** | `contracts/TruxifyEscrow.sol` | ✅ **Active** — deployed and used by the backend |

`TruxifyEscrow` is the production escrow contract. It uses OpenZeppelin's `ReentrancyGuard`, `Ownable`, and `Pausable` for security. The backend ABI in `backend/api/src/services/escrow.js` targets this contract exclusively.

### Expected ABI Functions

| Function | Selector | Used by |
|----------|----------|---------|
| `createBooking(uint256,address)` | `0xcf5ba53f` | `buildDepositTx()` in `escrow.js` |
| `releasePayment(uint256)` | `0x2d8e4a0b` | `escrowRelease()` in `escrow.js` |
| `cancelBooking(uint256)` | `0x66b71f1c` | `submitEscrowRefund()` in `escrow.js` |
| `bookings(uint256)` | `0xdc97d7d3` | `recordDepositTx()` / `escrowRelease()` in `escrow.js` |

> ⚠️ If `ESCROW_CONTRACT_ADDRESS` points to a contract with a different ABI (e.g., the deprecated `Escrow.sol`), all escrow operations will silently fail. The backend validates the deployed bytecode at startup to prevent this.

## Deprecated Contracts

| Contract | Location | Reason |
|----------|----------|--------|
| **Escrow** (old) | `contracts/deprecated/Escrow.sol` | Incompatible ABI (`bytes32` booking IDs, relayer pattern), missing OpenZeppelin security standards |

The old `Escrow.sol` used a different function interface (`deposit(bytes32,address,address)`, `releaseFunds(bytes32)`, `refundFunds(bytes32)`) that does **not** match the backend ABI. Do not deploy or reference it.

## Running Tests

```bash
cd blockchain
npx hardhat test
```

## Static Analysis

```bash
pip install slither-analyzer
slither contracts/TruxifyEscrow.sol
```
