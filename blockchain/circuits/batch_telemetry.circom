pragma circom 2.1.6;

/**
 * @title BatchTelemetry
 * @dev ZK circuit for batch-verifying telemetry state transitions.
 * 
 * SECURITY FIX (Issue #11248):
 * 1. Replaced mock multiply-add "Poseidon" with real circomlib Poseidon hash
 * 2. Added Merkle accumulation constraint linking computed hashes to roots
 * 3. Added per-ping sender binding (deviceKey + tripId + sequenceNumber)
 * 4. Added replay protection via monotonic sequence numbers
 * 
 * Public Inputs:
 * - initialMerkleRoot: Root before batch processing
 * - finalMerkleRoot: Root after batch processing
 * - deviceKey: Sender's public key (binds proof to device)
 * - tripId: Trip identifier (prevents cross-trip replay)
 * - startSequence: First sequence number in batch
 * - endSequence: Last sequence number in batch (must be startSequence + N - 1)
 * 
 * Private Inputs:
 * - telemetryPings[N][3]: Array of [lat, lng, timestamp] tuples
 * - previousHashes[N]: Previous state hashes for each ping
 */

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";

/**
 * Real Poseidon hash over 2 inputs using circomlib.
 * This is a cryptographically secure hash over the BN128 scalar field.
 * NOT invertible (unlike the previous mock a*b + 17).
 */
template PoseidonHash2() {
    signal input inputs[2];
    signal output out;
    
    component hasher = Poseidon(2);
    hasher.inputs[0] <== inputs[0];
    hasher.inputs[1] <== inputs[1];
    out <== hasher.out;
}

/**
 * Hashes a single telemetry ping with sender binding.
 * Commits to: deviceKey || tripId || sequenceNumber || lat || lng || timestamp || prevHash
 */
template PingHash() {
    signal input deviceKey;
    signal input tripId;
    signal input sequenceNumber;
    signal input lat;
    signal input lng;
    signal input timestamp;
    signal input prevHash;
    signal output out;
    
    // First hash: bind to sender identity and sequence
    component h1 = Poseidon(4);
    h1.inputs[0] <== deviceKey;
    h1.inputs[1] <== tripId;
    h1.inputs[2] <== sequenceNumber;
    h1.inputs[3] <== prevHash;
    
    // Second hash: incorporate location data
    component h2 = Poseidon(4);
    h2.inputs[0] <== h1.out;
    h2.inputs[1] <== lat;
    h2.inputs[2] <== lng;
    h2.inputs[3] <== timestamp;
    
    out <== h2.out;
}

/**
 * Validates that sequence numbers are monotonically increasing.
 * Prevents replay attacks by ensuring each ping has a unique sequence.
 */
template SequenceValidator() {
    signal input prevSeq;
    signal input currSeq;
    signal output isValid;
    
    // currSeq must equal prevSeq + 1
    signal diff;
    diff <== currSeq - prevSeq;
    
    // diff must be exactly 1 (monotonic increment)
    component isOne = IsEqual();
    isOne.in[0] <== diff;
    isOne.in[1] <== 1;
    
    isValid <== isOne.out;
    
    // Constraint: diff must equal 1
    diff === 1;
}

/**
 * Main batch telemetry verification circuit.
 * Processes N telemetry pings and verifies the state transition.
 */
template BatchTelemetry(N) {
    // Public inputs (visible to verifier)
    signal input initialMerkleRoot;
    signal input finalMerkleRoot;
    signal input deviceKey;
    signal input tripId;
    signal input startSequence;
    signal input endSequence;
    
    // Private inputs (known only to prover)
    signal input telemetryPings[N][3];  // [lat, lng, timestamp]
    signal input previousHashes[N];     // Previous state hash for each ping
    
    // Output: the batch is valid if all constraints pass
    signal output valid;
    
    // ── Step 1: Compute per-ping hashes with sender binding ───────────────
    
    component pingHashers[N];
    signal computedHashes[N];
    
    for (var i = 0; i < N; i++) {
        pingHashers[i] = PingHash();
        pingHashers[i].deviceKey <== deviceKey;
        pingHashers[i].tripId <== tripId;
        pingHashers[i].sequenceNumber <== startSequence + i;
        pingHashers[i].lat <== telemetryPings[i][0];
        pingHashers[i].lng <== telemetryPings[i][1];
        pingHashers[i].timestamp <== telemetryPings[i][2];
        pingHashers[i].prevHash <== previousHashes[i];
        
        computedHashes[i] <== pingHashers[i].out;
    }
    
    // ── Step 2: Validate monotonic sequence numbers ────────────────────────
    
    // endSequence must equal startSequence + N - 1
    signal expectedEndSeq;
    expectedEndSeq <== startSequence + N - 1;
    endSequence === expectedEndSeq;
    
    // ── Step 3: Accumulate hashes into running Merkle root ─────────────────
    
    signal accumulated[N + 1];
    accumulated[0] <== initialMerkleRoot;
    
    component accumulators[N];
    for (var i = 0; i < N; i++) {
        accumulators[i] = PoseidonHash2();
        accumulators[i].inputs[0] <== accumulated[i];
        accumulators[i].inputs[1] <== computedHashes[i];
        accumulated[i + 1] <== accumulators[i].out;
    }
    
    // ── Step 4: Constrain final accumulated root to match public output ─────
    
    accumulated[N] === finalMerkleRoot;
    
    // ── Step 5: Output validity signal ─────────────────────────────────────
    
    valid <== 1;  // All constraints must pass for valid proof
}

// ── Component Instantiation ──────────────────────────────────────────────────

// Batch size of 10 pings (configurable based on gas constraints)
component main {public [initialMerkleRoot, finalMerkleRoot, deviceKey, tripId, startSequence, endSequence]} = BatchTelemetry(10);
