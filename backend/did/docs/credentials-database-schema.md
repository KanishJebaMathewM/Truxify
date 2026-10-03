# Credentials Database Schema

## Overview
The `credentials` table stores Verifiable Credentials (VCs) issued by the Truxify Decentralized Identity (DID) service. This table is critical for the credential lifecycle, including issuance, verification, and revocation.

**Issue #9939 Resolution**: This table was previously missing from all migrations, causing `PGRST202` errors whenever the DID service attempted to interact with it. The migration `20260917120000_create_credentials_table.sql` resolves this.

## Table Structure

| Column | Type | Constraints | Description |
|---|---|---|---|
| `credential_id` | TEXT | PRIMARY KEY | Unique identifier (URN or UUID) for the credential. |
| `subject` | TEXT | NOT NULL | The DID of the entity receiving the credential. |
| `credential_type` | TEXT | NOT NULL | Type of VC (e.g., 'VerifiableCredential', 'TruxifyDriverLicense'). |
| `schema` | TEXT | NULLABLE | URL or JSON defining the credential's data structure. |
| `issued_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Timestamp of issuance. |
| `valid_until` | TIMESTAMPTZ | NULLABLE | Expiration timestamp. NULL means never expires. |
| `tx_hash` | TEXT | NULLABLE | Blockchain transaction hash if anchored on-chain. |
| `proof` | JSONB | NULLABLE | Cryptographic proof data (e.g., Ed25519 signature). |
| `revoked` | BOOLEAN | NOT NULL, DEFAULT FALSE | Revocation status. |
| `revoked_at` | TIMESTAMPTZ | NULLABLE | Timestamp when the credential was revoked. |
| `owner_id` | UUID | FK -> profiles(id) | The user profile that owns/manages this credential record. |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Record creation time. |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT NOW() | Last update time (auto-updated via trigger). |

## Indexes
To ensure performant queries as the credential registry grows, the following indexes are created:

1. **`idx_credentials_subject`**: Speeds up lookups by the credential subject's DID.
2. **`idx_credentials_type`**: Speeds up filtering by credential type.
3. **`idx_credentials_owner`**: Speeds up queries for all credentials owned by a specific user.
4. **`idx_credentials_revoked`**: Partial index on `revoked = TRUE` to quickly find all revoked credentials (used in revocation lists).
5. **`idx_credentials_issued_at`**: Descending index on issuance time for sorting recent credentials.

## Row Level Security (RLS)
RLS is enabled to ensure users can only manage their own credentials.

### Policies
1. **SELECT**: Users can view credentials where `owner_id = auth.uid()` OR where the `subject` matches their DID.
2. **INSERT**: Users can only insert credentials where `owner_id = auth.uid()`.
3. **UPDATE**: Users can only update (e.g., revoke) credentials where `owner_id = auth.uid()`.
4. **Service Role**: The backend service role (used by `did.service.js`) automatically bypasses RLS for system-level operations like bulk stats gathering.

## Triggers
- **`trigger_credentials_updated_at`**: Automatically updates the `updated_at` column to `NOW()` on any UPDATE operation, ensuring accurate audit trails.

## Usage in DID Service
The `backend/did/did.service.js` interacts with this table via three primary methods:

### 1. `storeCredential(data)`
Inserts a new VC into the table. Requires `credentialId`, `subject`, `credentialType`, and `proof`.

### 2. `updateCredentialStatus(credentialId, revoked)`
Updates the `revoked` boolean and `revoked_at` timestamp. This is the core mechanism for credential revocation.

### 3. `getDIDStats()`
Queries the table to return aggregate statistics (total issued, total revoked, recent issuances). Uses `.order('issued_at', { ascending: false }).limit(100)`.

## Maintenance
- **Vacuuming**: As credentials are revoked, the table may bloat. Regular `VACUUM ANALYZE` is recommended.
- **Archival**: Expired credentials (`valid_until < NOW()`) should be periodically archived to cold storage to keep the active table small and performant.

---
