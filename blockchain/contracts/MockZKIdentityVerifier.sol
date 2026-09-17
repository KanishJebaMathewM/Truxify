// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockZKIdentityVerifier {
    function verifyProof(bytes calldata proof, uint256[] calldata) external pure returns (bool) {
        return keccak256(proof) == keccak256(bytes("valid-proof"));
    }
}
