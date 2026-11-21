
# DAO Governance Security Architecture

## Problem Statement (Issue #13888)

The initial implementation of DAO governance routes (`/dao/vote/cast`, `/dao/proposal/create`, etc.) lacked proper authentication and authorization.

This introduced several security vulnerabilities:

1. **Identity Impersonation:** Anonymous clients could submit arbitrary `voterAddress` values. The server used its own private key to submit transactions, potentially creating inconsistencies between on-chain and database records.

2. **Server Wallet Abuse:** Governance transactions were signed using the server's hot wallet, giving the server excessive control over governance operations.

3. **Missing On-Chain Execution:** The `executeProposal` route updated the database status without invoking the actual smart contract execution function.

## Solution: Cryptographic Identity Verification

### 1. Supabase JWT Authentication

All `/dao/*` routes require a valid Supabase access token in the following header:

`Authorization: Bearer <token>`

The authentication middleware must:

- Verify the JWT signature using trusted Supabase configuration.
- Validate the issuer, audience, expiration, and token claims.
- Extract the authenticated user's Supabase ID.
- Retrieve the user's registered wallet address from a trusted database record.
- Reject missing, invalid, expired, or revoked credentials.

Never trust user identity or wallet addresses supplied only through request bodies.

### 2. Wallet Address Ownership Verification

When a user attempts to vote or create a proposal, the server verifies the claimed wallet address against the authenticated user's registered wallet address.

- **Matching Addresses:** Authorize the wallet identity after successful JWT validation and wallet ownership checks.
- **Different Addresses:** Require an additional cryptographic signature proving ownership of the connected wallet.

A successful signature verification proves wallet ownership, but does not independently grant DAO permissions. The server must also check proposal eligibility, voting rights, and role-based authorization.

### 3. EIP-191 Signature Verification

When the connected wallet differs from the registered wallet, the client must provide:

- `X-DAO-Signature`: The wallet's cryptographic signature.
- `X-DAO-Message`: The exact message signed by the wallet.
- `X-DAO-Nonce`: A server-issued, single-use nonce.

The backend must:

1. Validate the authenticated Supabase user.
2. Retrieve the issued nonce from trusted server-side storage.
3. Verify that the nonce is valid, unused, and unexpired.
4. Validate the message against the expected action and authenticated user.
5. Recover the signer using `ethers.verifyMessage()`.
6. Compare the recovered address with the claimed wallet address.
7. Consume the nonce atomically to prevent replay attacks.

**Standardized Message Format:**

```text
Truxify DAO Action
Action: <action_type>
User: <supabase_user_id>
DAO: <dao_identifier>
Nonce: <server_generated_nonce>
Issued At: <timestamp>
Expires At: <timestamp>
```

The server must construct or validate the exact expected message. Client-provided timestamps and nonces must never be trusted without server-side validation.

### 4. Secure Transaction Signing

- Never expose private keys or signing credentials to clients.
- Never use the server's hot wallet to impersonate individual voters.
- Use client-side wallet signing for user-authorized governance transactions.
- If relayer transactions are supported, implement explicit authorization, replay protection, and contract-level signature verification.
- Validate transaction parameters before submission.

### 5. On-Chain Proposal Execution Fix

The `executeProposal` route must:

1. Authenticate the caller using Supabase JWT middleware.
2. Verify that the caller has the required executor permissions.
3. Validate the proposal ID and current proposal state.
4. Confirm that the proposal satisfies the smart contract's execution requirements.
5. Submit the actual `daoContract.execute(proposalId)` transaction using an authorized signer.
6. Wait for the transaction receipt.
7. Verify that the transaction succeeded and emitted the expected execution event.
8. Update the database status to `executed` only after successful on-chain execution.

If the transaction fails or reverts, the database must not mark the proposal as executed.

Implement idempotency and transaction reconciliation to handle duplicate requests, network failures, and cases where the transaction succeeds but the database update fails.

### 6. Additional Security Measures

- Apply rate limiting to sensitive DAO endpoints.
- Validate all request parameters.
- Use HTTPS for all API communication.
- Keep private keys in secure secret management systems.
- Maintain audit logs for governance operations.
- Prevent duplicate voting through on-chain checks.
- Restrict proposal execution to authorized accounts.
- Avoid logging JWTs, private keys, or complete sensitive signatures.
- Add unit tests and integration tests for authentication, authorization, signature verification, replay prevention, and transaction failures.

## Client Integration Guide

When building the Truxify DAO dashboard:

1. Include the Supabase access token in every DAO API request.
2. Connect the user's Web3 wallet.
3. Compare the connected wallet address with the registered profile wallet address.
4. If the addresses differ, request a server-issued nonce.
5. Ask the user to sign the standardized EIP-191 message.
6. Submit the signature, exact message, and nonce to the backend.
7. Handle authorization failures and transaction errors appropriately.
8. Never send private keys or seed phrases to the backend.

## Expected Outcome

The updated DAO governance architecture provides:

- Secure Supabase authentication.
- Cryptographic wallet ownership verification.
- Replay-resistant signature validation.
- Proper governance authorization.
- Secure transaction signing.
- Actual smart contract proposal execution.
- Better synchronization between blockchain and database records.

**Security Note:** This document describes the required security architecture. Actual security depends on the implementation, smart contract permissions, tests, and deployment configuration.
