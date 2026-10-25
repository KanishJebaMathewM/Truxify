# Batch Telemetry ZK Circuit

## Overview
The `batch_telemetry.circom` circuit provides zero-knowledge proof of valid telemetry state transitions. It allows a driver's device to prove it generated a batch of GPS pings without revealing the actual coordinates, while binding the proof to the device identity and trip.

**Issue #11248**: Replaced the mock multiply-add "Poseidon" with real cryptographic hashing and added Merkle accumulation constraints.

## Circuit Architecture

### Public Inputs (Visible to Verifier)
| Input | Type | Description |
|-------|------|-------------|
| `initialMerkleRoot` | field | State root before batch |
| `finalMerkleRoot` | field | State root after batch |
| `deviceKey` | field | Sender's public key |
| `tripId` | field | Trip identifier |
| `startSequence` | field | First sequence number |
| `endSequence` | field | Last sequence number |

### Private Inputs (Known Only to Prover)
| Input | Type | Description |
|-------|------|-------------|
| `telemetryPings[N][3]` | field array | `[lat, lng, timestamp]` tuples |
| `previousHashes[N]` | field array | Previous state hash per ping |

## Security Properties

### 1. Real Poseidon Hash
**Before (Vulnerable):**
```circom
out <== inputs[0] * inputs[1] + 17;  // Trivially invertible
```

**After (Secure):**
```circom
component hasher = Poseidon(2);
hasher.inputs[0] <== inputs[0];
hasher.inputs[1] <== inputs[1];
out <== hasher.out;
```

Uses circomlib's Poseidon over the BN128 scalar field. Cryptographically secure, non-invertible.

### 2. Merkle Accumulation
The circuit constrains:
```
accumulated[0] = initialMerkleRoot
accumulated[i+1] = Poseidon(accumulated[i], computedHashes[i])
accumulated[N] = finalMerkleRoot
```

This ensures the final root is the authenticated accumulation of all ping hashes.

### 3. Sender Binding
Each ping hash commits to:
```
H(deviceKey || tripId || sequenceNumber || prevHash || lat || lng || timestamp)
```

Prevents:
- **Cross-device replay**: Proof bound to specific `deviceKey`
- **Cross-trip replay**: Proof bound to specific `tripId`
- **Sequence replay**: Monotonic `sequenceNumber` enforced

### 4. Monotonic Sequences
Constraint: `endSequence === startSequence + N - 1`

Ensures no gaps or reordering in the batch.

## Generating Valid Proofs

### Backend Producer (Python)
See `backend/ml/gnn/telemetry_proofs.py` for the proof generation logic.

### Example Usage
```javascript
const input = {
  initialMerkleRoot: currentRoot,
  finalMerkleRoot: computedFinalRoot,
  deviceKey: driverPublicKey,
  tripId: currentTripId,
  startSequence: lastSequence + 1,
  endSequence: lastSequence + batchSize,
  telemetryPings: batchPings,
  previousHashes: prevHashes,
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  input,
  wasmFile,
  zkeyFile
);
```

## On-Chain Verification

The Solidity verifier contract checks:
1. Proof validity (Groth16 verification)
2. `deviceKey` matches registered device
3. `tripId` matches active trip
4. `startSequence` > last verified sequence (replay protection)

## Testing

```bash
cd blockchain
npx hardhat test test/batch_telemetry.test.js
```

### Test Coverage
- ✅ Circuit compiles with real Poseidon
- ✅ Valid batches verify
- ✅ Invalid sequence ranges rejected
- ✅ Mismatched Merkle roots rejected
- ✅ Old mock proofs rejected
- ✅ Proof binding to deviceKey verified
- ✅ Proof binding to tripId verified

## Gas Costs

| Operation | Gas (approx) |
|-----------|-------------|
| Circuit verification | ~250,000 |
| Storage update | ~50,000 |
| **Total** | **~300,000** |

## Migration from Mock

The old mock circuit proofs are **invalid** under the new circuit. All existing proofs must be regenerated using the real Poseidon hash.

## Related Issues
- #11248 - This fix
- Related: WIM proof circuit, IoT attestation
