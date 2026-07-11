# ⛓️ Blockchain & Trust Layer

Truxify integrates **Polygon** (via the Amoy testnet in development) to establish an immutable trust layer. This system manages financial escrows, secures driver document hashes, and hosts portable, decentralized reputation scores.

---

## 🤷 Why Polygon?

Freight networks involve parties with low mutual trust: manufacturers, fleet managers, and independent truck drivers.
* **Decentralization**: Financial funds are locked in code (escrow smart contracts) rather than on the platform's balance sheet.
* **Low Costs**: Transactions on Polygon POS cost fractions of a cent ($<\$0.001$), making it feasible to record every order lifecycle event.
* **Speed**: Block confirmation times of ~2 seconds match the requirements of real-time supply chain updates.

---

## 📜 Core Solidity Smart Contracts

Truxify's contracts are located in the `/blockchain/contracts` folder and developed using **Hardhat**.

### 1. Payment Escrow (`TruxifyEscrow.sol`)
The `TruxifyEscrow` contract acts as a digital container for trip funds. It manages payments throughout the booking lifecycle:

> ⚠️ **Note**: The codebase previously contained two incompatible escrow contracts (`Escrow.sol` and `TruxifyEscrow.sol`). The old `Escrow.sol` has been **deprecated** and moved to `contracts/deprecated/Escrow.sol`. The backend exclusively targets `TruxifyEscrow.sol`. Do not deploy or reference the old `Escrow.sol`.

```
[Customer Books Order]
         │
         ▼
[Deposit INR/Stablecoin into Escrow] ──► (Funds Locked in Contract)
         │
         ├───► [Customer Cancels Before Trip] ────► [Refund 100% to Customer]
         │
         ├───► [Driver Cancels After Route Init] ─► [Proportional penalty to Driver]
         │
         ├───► [Dispute Triggered / OTP Failure] ──► [Lock Contract & Notify n8n]
         │
         ▼
[OTP Verified + Geofence Reached]
         │
         ▼
[Auto-release Funds to Driver Wallet]
```

* **Locking Funds**: When a bid is accepted, the customer's payment is deposited into the contract.
* **Escrow Release**: Release is triggered programmatically by the Express API only after matching the customer's OTP and verifying that the driver's GPS location fell within the delivery geofence.
* **Cancellation Penalties**:
  * If a customer cancels after the truck is en route, a distance-proportional penalty is sent to the driver, and the remainder is refunded.
  * If a driver cancels, their trust rating is impacted on-chain, and the full payment returns to the customer.

### 2. Portable Reputation (`Reputation.sol`)
Independent truck drivers in India often lose their history when changing platforms. `Reputation.sol` creates a portable record:
* **Tamper-Proof Star Ratings**: Reviews are hashed and logged on-chain after every completed trip.
* **Immutable Aggregations**: Ratings cannot be edited or deleted by Truxify.
* **Portability**: A driver can export their public key to prove their track record on other platforms or to apply for vehicle loans.

---

## 📄 Document Hash Integrity

To prevent fraud (such as fake licenses or invalid registration certificates), Truxify stores documents securely using cryptographic hashes:

1. **Upload**: The driver uploads a document scan (e.g., driver's license PDF) via the app.
2. **Hashing**: The Express API saves the file to Cloudflare R2 and calculates its cryptographic hash:
   $$\text{hash} = \text{Keccak-256}(\text{document bytes})$$
3. **On-Chain Recording**: The document ID, expiry date, and hash are recorded in the `documents` table and written to the blockchain.
4. **Verification**: If a driver alters a document scan on their phone or if a database entry is modified, the file's hash will not match the on-chain registry, flagging the account.

---

## 🧾 On-Chain Delivery Receipts

Upon successful OTP validation, a delivery receipt is minted to the Polygon ledger containing:
* Hashed order ID
* Cargo description summary
* Origin and destination coordinates
* Timestamp
* Carrier and shipper addresses

These receipts serve as tamper-proof delivery records that can be used for GST tax filings, commercial audits, and legal dispute resolutions.
