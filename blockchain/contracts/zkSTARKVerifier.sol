// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ISTARKVerifier {
    function verifyProof(
        uint256 programHash,
        uint256[] calldata publicInputs,
        bytes calldata proof
    ) external view returns (bool);
}

contract zkSTARKVerifier {
    // Real STARK verification (e.g. a Cairo/FRI verifier or a precompiled
    // verifier) is delegated to the immutable `verifier`. Without a genuine
    // verifier the result is always false/reverting, never a blind accept.
    ISTARKVerifier public immutable verifier;

    constructor(address _verifier) {
        require(_verifier != address(0), "Invalid verifier");
        verifier = ISTARKVerifier(_verifier);
    }

    function verifyProof(bytes calldata proof, bytes calldata publicInputs)
        external
        view
        returns (bool)
    {
        require(proof.length > 0, "Proof is empty");
        // Decode the public inputs (program hash + inputs) and run the real
        // verification, reverting on any mismatch.
        (uint256 programHash, uint256[] memory pi) =
            abi.decode(publicInputs, (uint256, uint256[]));
        return verifier.verifyProof(programHash, pi, proof);
    }
}
