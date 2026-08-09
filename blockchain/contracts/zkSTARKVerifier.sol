// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract zkSTARKVerifier {
    // Simplified zk-STARK verifier
    // In production: use actual STARK verification

    function verifyProof(
        bytes calldata proof,
        bytes calldata publicInputs
    ) external pure returns (bool) {
        // Reject empty and all-zero proofs instead of accepting every proof
        if (!_hasNonZeroByte(proof) || !_hasNonZeroByte(publicInputs)) {
            return false;
        }
        // Placeholder verification
        return true;
    }

    function _hasNonZeroByte(bytes calldata data) internal pure returns (bool) {
        for (uint i = 0; i < data.length; i++) {
            if (data[i] != 0) return true;
        }
        return false;
    }
}