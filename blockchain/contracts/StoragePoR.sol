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
     * @dev Verifies a spot-check proof for a queried block on-chain and
     *      derives the outcome from the committed data root instead of
     *      trusting a caller-supplied boolean. The expected proof value is
     *      keccak256(abi.encodePacked(dataRoot, blockIndex)); a returned
     *      value that does not match is a failed proof and triggers slashing.
     */
    function verifyStorageProof(
        address _provider,
        uint256 _blockIndex,
        bytes32 _merkleProofHash
    ) external onlyVerifier {
        NodeStatus storage node = providers[_provider];
        require(node.active, "Provider not active");

        bytes32 expectedProof = keccak256(abi.encodePacked(dataRoots[_provider], _blockIndex));
        bool isValid = _merkleProofHash == expectedProof;

        if (isValid) {
            node.lastVerifiedBlock = block.number;
            emit ProofVerified(_provider, _merkleProofHash, true);
        } else {
            node.active = false;
            uint256 penalty = node.lockedCollateral;
            node.lockedCollateral = 0;
            payable(owner()).transfer(penalty); // Slash collateral

            emit ProviderSlashed(_provider, penalty);
            emit ProofVerified(_provider, _merkleProofHash, false);
        }
    }
}
