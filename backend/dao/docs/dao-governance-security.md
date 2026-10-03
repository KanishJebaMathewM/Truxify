# DAO Governance Security Architecture

## Problem Statement (Issue #13888)
The initial implementation of the DAO governance routes (`/dao/vote/cast`, `/dao/proposal/create`, etc.) lacked authentication and authorization. 
1. **Impersonation**: Any anonymous client could submit a `voterAddress` in the request body, and the server would blindly cast a vote on-chain using the **server's private key**, recording the user's claimed address in the DB. This meant the on-chain ledger diverged from the DB ledger.
2. **Server Wallet Abuse**: All transactions were signed by the server's hot wallet, meaning the server had unilateral control over all governance actions.
3. **Missing Execution**: `executeProposal` only updated the DB status but never actually called the on-chain `execute()` function.

## Solution: Cryptographic Identity Verification

### 1. Supabase JWT Authentication
All `/dao/*` routes now require a valid Supabase JWT in the `Authorization: Bearer <token>` header. The middleware extracts the user's registered `wallet_address` from the token claims.

### 2. Address Ownership Verification
When a user attempts to vote or propose, the middleware compares the `voterAddress`/`proposer` in the request body against the `wallet_address` in the JWT.

- **Match**: If they match, the action is authorized. The server constructs the transaction using the user's verified identity (or delegates to a client-side signer).
- **Mismatch**: If they do not match (e.g., a user wants to vote from a hardware wallet not linked to their Supabase email), the user MUST provide an EIP-191 signature.

### 3. EIP-191 Signature Fallback
If the addresses mismatch, the client must send:
- `X-DAO-Signature`: The cryptographic signature.
- `X-DAO-Message`: The exact message that was signed.

The middleware recovers the signer address using `ethers.verifyMessage()`. If the recovered address matches the claimed `voterAddress`, the action is authorized.

**Message Format Requirement:**
To prevent replay attacks, the message MUST contain:
```text
Truxify DAO Action: <action_type>
User: <supabase_user_id>
Nonce: <timestamp_or_nonce>
```

### 4. On-Chain Execution Fix
The `executeProposal` route now:
1. Verifies the caller is an authorized executor (via the same auth middleware).
2. Calls the actual smart contract `daoContract.execute(proposalId)`.
3. Waits for the transaction receipt.
4. ONLY IF the on-chain transaction succeeds, updates the DB status to `executed`.

This ensures the DB state never diverges from the blockchain state.

## Client Integration Guide
When building the frontend DAO dashboard:
1. Always include the Supabase JWT in the `Authorization` header.
2. If the user's connected Web3 wallet address differs from their profile address, prompt them to sign the standardized message format before submitting the vote.
3. Never send private keys to the server. The server only needs the signature proof.
