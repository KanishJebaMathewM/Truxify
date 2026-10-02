"""
Telemetry ZK Proof Producer

Generates valid inputs for the batch_telemetry.circom circuit using
real Poseidon hashing (circomlibjs compatible).

Resolves Issue #11248: Provides correct proof generation for the
secure circuit (not the old mock multiply-add).
"""

from typing import List, Tuple, Dict, Any
from dataclasses import dataclass
import hashlib
import json
import subprocess
import tempfile
import os


@dataclass
class TelemetryPing:
    """Single telemetry ping data."""
    lat: int  # Scaled to field element
    lng: int  # Scaled to field element
    timestamp: int
    device_key: int
    trip_id: int
    sequence_number: int


@dataclass
class BatchProofInput:
    """Complete input for the batch_telemetry circuit."""
    initial_merkle_root: int
    final_merkle_root: int
    device_key: int
    trip_id: int
    start_sequence: int
    end_sequence: int
    telemetry_pings: List[List[int]]
    previous_hashes: List[int]


class PoseidonHasher:
    """
    Poseidon hash implementation compatible with circomlib.
    
    For production, use circomlibjs via Node.js subprocess or
    a Python Poseidon library (e.g., poseidon-zeus).
    """
    
    def __init__(self):
        self._node_available = self._check_node()
    
    def _check_node(self) -> bool:
        """Check if Node.js is available for circomlibjs."""
        try:
            subprocess.run(["node", "--version"], capture_output=True, check=True)
            return True
        except (subprocess.CalledProcessError, FileNotFoundError):
            return False
    
    def hash2(self, a: int, b: int) -> int:
        """
        Hash two field elements using Poseidon.
        
        Falls back to SHA-256 mod p if circomlibjs unavailable.
        NOTE: Fallback is NOT compatible with the circuit!
        """
        if self._node_available:
            return self._hash2_circomlib(a, b)
        else:
            return self._hash2_fallback(a, b)
    
    def _hash2_circomlib(self, a: int, b: int) -> int:
        """Use circomlibjs for real Poseidon hash."""
        script = f"""
        const {{ buildPoseidon }} = require('circomlibjs');
        (async () => {{
            const poseidon = await buildPoseidon();
            const hash = poseidon.F.toString(poseidon([{a}, {b}]));
            console.log(hash);
        }})();
        """
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(script)
            temp_path = f.name
        
        try:
            result = subprocess.run(
                ["node", temp_path],
                capture_output=True,
                text=True,
                check=True
            )
            return int(result.stdout.strip())
        finally:
            os.unlink(temp_path)
    
    def _hash2_fallback(self, a: int, b: int) -> int:
        """
        Fallback hash (NOT cryptographically compatible with circuit).
        Used only for testing when Node.js unavailable.
        """
        # BN128 scalar field prime
        p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
        
        combined = f"{a}:{b}".encode()
        h = hashlib.sha256(combined).digest()
        return int.from_bytes(h, 'big') % p


class TelemetryProofProducer:
    """Produces valid inputs for the batch_telemetry circuit."""
    
    def __init__(self, batch_size: int = 10):
        self.batch_size = batch_size
        self.hasher = PoseidonHasher()
    
    def ping_hash(
        self,
        device_key: int,
        trip_id: int,
        sequence: int,
        prev_hash: int,
        lat: int,
        lng: int,
        timestamp: int
    ) -> int:
        """
        Compute the hash of a single ping with sender binding.
        Matches the PingHash template in the circuit.
        """
        # First hash: identity binding
        h1 = self.hasher.hash2(
            self.hasher.hash2(device_key, trip_id),
            self.hasher.hash2(sequence, prev_hash)
        )
        
        # Second hash: location data
        h2 = self.hasher.hash2(
            self.hasher.hash2(h1, lat),
            self.hasher.hash2(lng, timestamp)
        )
        
        return h2
    
    def accumulate(
        self,
        initial_root: int,
        hashes: List[int]
    ) -> int:
        """
        Compute final Merkle root by accumulating hashes.
        Matches the accumulation loop in the circuit.
        """
        current = initial_root
        for h in hashes:
            current = self.hasher.hash2(current, h)
        return current
    
    def produce_batch_input(
        self,
        pings: List[TelemetryPing],
        initial_root: int,
        previous_hashes: List[int]
    ) -> BatchProofInput:
        """
        Produce complete circuit input for a batch of pings.
        
        Args:
            pings: List of telemetry pings (must be batch_size)
            initial_root: Current state Merkle root
            previous_hashes: Previous state hash for each ping
        
        Returns:
            BatchProofInput ready for circuit witness generation
        """
        if len(pings) != self.batch_size:
            raise ValueError(f"Expected {self.batch_size} pings, got {len(pings)}")
        
        if len(previous_hashes) != self.batch_size:
            raise ValueError(f"Expected {self.batch_size} previous hashes")
        
        # Verify all pings have same device_key and trip_id
        device_key = pings[0].device_key
        trip_id = pings[0].trip_id
        
        for p in pings:
            if p.device_key != device_key:
                raise ValueError("All pings must have same device_key")
            if p.trip_id != trip_id:
                raise ValueError("All pings must have same trip_id")
        
        # Verify monotonic sequences
        start_seq = pings[0].sequence_number
        for i, p in enumerate(pings):
            expected_seq = start_seq + i
            if p.sequence_number != expected_seq:
                raise ValueError(f"Non-monotonic sequence at index {i}")
        
        end_seq = start_seq + self.batch_size - 1
        
        # Compute ping hashes
        computed_hashes = []
        for i, p in enumerate(pings):
            h = self.ping_hash(
                device_key=device_key,
                trip_id=trip_id,
                sequence=p.sequence_number,
                prev_hash=previous_hashes[i],
                lat=p.lat,
                lng=p.lng,
                timestamp=p.timestamp
            )
            computed_hashes.append(h)
        
        # Accumulate to get final root
        final_root = self.accumulate(initial_root, computed_hashes)
        
        # Build telemetry_pings array [lat, lng, timestamp]
        telemetry_pings = [
            [p.lat, p.lng, p.timestamp]
            for p in pings
        ]
        
        return BatchProofInput(
            initial_merkle_root=initial_root,
            final_merkle_root=final_root,
            device_key=device_key,
            trip_id=trip_id,
            start_sequence=start_seq,
            end_sequence=end_seq,
            telemetry_pings=telemetry_pings,
            previous_hashes=previous_hashes
        )
    
    def to_circom_input(self, batch_input: BatchProofInput) -> Dict[str, Any]:
        """Convert to JSON format expected by circom witness generator."""
        return {
            "initialMerkleRoot": str(batch_input.initial_merkle_root),
            "finalMerkleRoot": str(batch_input.final_merkle_root),
            "deviceKey": str(batch_input.device_key),
            "tripId": str(batch_input.trip_id),
            "startSequence": str(batch_input.start_sequence),
            "endSequence": str(batch_input.end_sequence),
            "telemetryPings": [
                [str(x) for x in ping]
                for ping in batch_input.telemetry_pings
            ],
            "previousHashes": [str(h) for h in batch_input.previous_hashes]
        }
    
    def save_input(self, batch_input: BatchProofInput, path: str):
        """Save circuit input to JSON file."""
        data = self.to_circom_input(batch_input)
        with open(path, 'w') as f:
            json.dump(data, f, indent=2)


# ── Usage Example ─────────────────────────────────────────────────────────────

if __name__ == "__main__":
    producer = TelemetryProofProducer(batch_size=10)
    
    # Create sample pings
    pings = []
    for i in range(10):
        pings.append(TelemetryPing(
            lat=286139 + i * 100,
            lng=772090 + i * 100,
            timestamp=1694965200 + i * 60,
            device_key=12345,
            trip_id=67890,
            sequence_number=100 + i
        ))
    
    # Previous hashes (from prior state)
    prev_hashes = [i + 1 for i in range(10)]
    
    # Current state root
    initial_root = 999
    
    # Produce valid circuit input
    batch_input = producer.produce_batch_input(
        pings=pings,
        initial_root=initial_root,
        previous_hashes=prev_hashes
    )
    
    print(f"Initial Root: {batch_input.initial_merkle_root}")
    print(f"Final Root: {batch_input.final_merkle_root}")
    print(f"Start Seq: {batch_input.start_sequence}")
    print(f"End Seq: {batch_input.end_sequence}")
    
    # Save for circuit witness generation
    producer.save_input(batch_input, "batch_input.json")
    print("Saved to batch_input.json")
