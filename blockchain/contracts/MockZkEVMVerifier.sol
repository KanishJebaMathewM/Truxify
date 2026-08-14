// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test-only verifier that accepts every proof so the zkEVM execution
///         paths can be exercised without a real Groth16 proof. Never used in
///         production deployments.
contract MockZkEVMVerifier {
    function verifyProof(
        uint[2] memory,
        uint[2][2] memory,
        uint[2] memory,
        uint[2] memory
    ) external pure returns (bool) {
        return true;
    }
}
