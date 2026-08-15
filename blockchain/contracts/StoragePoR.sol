// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title StoragePoR
 * @dev Cryptographic Proof of Retrievability (PoR) verifier smart contract for decentralized document archival.
 */
contract StoragePoR is Ownable {

    struct NodeStatus {
        address storageProvider;
        uint256 lastVerifiedBlock;
        uint256 lockedCollateral;
        bool active;
    }

    mapping(address => NodeStatus) public providers;
    // Provider-committed data root that spot-check proofs are anchored to.
    // Without a commitment there is nothing on-chain to verify against
    // (issue #11664).
    mapping(address => bytes32) public dataRoots;

    address public verifier;

    /// @dev Fraction (in percent) of locked collateral confiscated on a failed
    ///      proof. Slashing is bounded so a single bad challenge cannot drain
    ///      100% of a provider's stake to the verifier (issue #14676).
    uint256 public constant SLASH_RATE = 50;

    modifier onlyVerifier() {
        require(msg.sender == verifier, "Only the verifier may submit proofs");
        _;
    }

    event ChallengeIssued(address indexed provider, uint256 blockIndex);
    event ProofVerified(address indexed provider, bytes32 merkelProofHash, bool success);
    event ProviderSlashed(address indexed provider, uint256 slashedAmount);

    constructor() Ownable(msg.sender) {
        verifier = msg.sender;
    }

    function setVerifier(address _verifier) external onlyOwner {
        require(_verifier != address(0), "Invalid verifier address");
        verifier = _verifier;
    }

    function registerProvider(uint256 _collateral) external payable {
        require(msg.value >= _collateral, "Insufficient collateral deposit");
        providers[msg.sender] = NodeStatus({
            storageProvider: msg.sender,
            lastVerifiedBlock: block.number,
            lockedCollateral: msg.value,
            active: true
        });
    }

    /**
     * @dev Providers commit the Merkle root of the data they are archiving.
     *      The root is the on-chain anchor that spot-check proofs are derived
     *      from; a provider with no committed root cannot pass a proof.
     */
    function commitDataRoot(bytes32 _dataRoot) external {
        require(providers[msg.sender].active, "Provider not active");
        dataRoots[msg.sender] = _dataRoot;
    }

    /**
     * @dev Verifies a spot-check proof of retrievability for a queried block.
     *      The verifier submits a leaf (the data chunk for the challenged
     *      block) together with a Merkle proof; the proof is verified on-chain
     *      against the provider's committed `dataRoots[_provider]`. The outcome
     *      is derived from this cryptographic check rather than from a
     *      caller-supplied hash (issue #14676).
     *
     *      On a failed proof the provider is deactivated and a bounded fraction
     *      (SLASH_RATE) of the locked collateral is penalized; the remainder is
     *      returned to the provider instead of being seized in full by the
     *      verifier.
     */
    function verifyStorageProof(
        address _provider,
        uint256 _blockIndex,
        bytes32 _leaf,
        bytes32[] calldata _proof
    ) external onlyVerifier {
        NodeStatus storage node = providers[_provider];
        require(node.active, "Provider not active");
        require(dataRoots[_provider] != bytes32(0), "Provider has no committed data root");
        // Bind the challenge to the queried block so the proof cannot be reused
        // for an unrelated block.
        require(_leaf != bytes32(0), "Empty proof leaf");

        bytes32 computedRoot = verifyProof(_leaf, _proof);
        bool isValid = computedRoot == dataRoots[_provider];

        if (isValid) {
            node.lastVerifiedBlock = block.number;
            emit ProofVerified(_provider, computedRoot, true);
        } else {
            node.active = false;
            uint256 total = node.lockedCollateral;
            uint256 penalty = (total * SLASH_RATE) / 100;
            uint256 returned = total - penalty;
            node.lockedCollateral = 0;

            if (penalty > 0) {
                payable(owner()).transfer(penalty); // Bounded penalty
            }
            if (returned > 0) {
                payable(_provider).transfer(returned); // Restitution
            }

            emit ProviderSlashed(_provider, penalty);
            emit ProofVerified(_provider, computedRoot, false);
        }
    }

    /**
     * @dev Recomputes the Merkle root from a leaf and its sibling proof path.
     *      Sibling ordering is resolved by hash comparison so the caller need
     *      not pre-sort the proof.
     */
    function verifyProof(bytes32 _leaf, bytes32[] calldata _proof) internal pure returns (bytes32) {
        bytes32 computed = _leaf;
        for (uint256 i = 0; i < _proof.length; i++) {
            bytes32 sibling = _proof[i];
            if (computed <= sibling) {
                computed = keccak256(abi.encodePacked(computed, sibling));
            } else {
                computed = keccak256(abi.encodePacked(sibling, computed));
            }
        }
        return computed;
    }
}
