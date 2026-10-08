// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AggregatedVerifier
 * @dev Reserved interface for aggregated ZK proofs. No SnarkPack verifier is
 * configured, so this placeholder rejects every proof until a vetted verifier
 * binds the proof, commitment and count cryptographically.
 */
contract AggregatedVerifier is Ownable {

    event BatchVerified(bytes32 indexed aggregationCommitment, uint256 count, bool success);
    error AggregatedVerificationUnavailable(bytes32 aggregationCommitment, uint256 proofCount);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Fails closed: dimensions alone cannot authenticate delivery records.
     */
    function verifyAggregatedProof(
        bytes32 _aggregationCommitment,
        uint256 _proofCount,
        bytes calldata _aggregatedProofBytes
    ) external pure returns (bool) {
        require(_proofCount > 0, "Proof count must be > 0");
        require(_aggregatedProofBytes.length >= 64, "Invalid aggregated proof bytes dimensions");

        revert AggregatedVerificationUnavailable(_aggregationCommitment, _proofCount);
    }
}
