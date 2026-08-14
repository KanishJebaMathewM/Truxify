// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockSTARKVerifier {
    // Test double: accepts only a proof whose hash matches the known-good
    // value; every arbitrary proof is rejected.
    function verifyProof(
        uint256,
        uint256[] calldata,
        bytes calldata proof
    ) external pure returns (bool) {
        return keccak256(proof) == keccak256("accepted-proof");
    }
}
