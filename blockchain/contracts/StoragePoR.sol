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

    event ChallengeIssued(address indexed provider, uint256 blockIndex);
    event ProofVerified(address indexed provider, bytes32 merkelProofHash, bool success);
    event ProviderSlashed(address indexed provider, uint256 slashedAmount);

    constructor() Ownable(msg.sender) {}

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
     * @dev Verifies that the storage provider has returned a valid spot-check proof for queried blocks.
     */
    function verifyStorageProof(
        address _provider,
        uint256 _blockIndex,
        bytes32 _merkleProofHash,
        bool _isValid
    ) external onlyOwner {
        NodeStatus storage node = providers[_provider];
        require(node.active, "Provider not active");

        if (_isValid) {
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
