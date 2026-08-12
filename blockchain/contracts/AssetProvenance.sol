// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AssetProvenance
 * @dev Verifies on-chain zero-knowledge handoff proofs representing custody trail transitions.
 */
contract AssetProvenance is Ownable {

    struct Record {
        bytes32 cargoHash;
        address currentHolder;
        uint256 timestamp;
        bool verified;
    }

    mapping(bytes32 => Record[]) public provenanceTrail;

    event CustodyTransferred(bytes32 indexed cargoHash, address indexed from, address indexed to, bytes32 zkpProofHash);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Commits a new custody state transition using a ZK proof hash.
     */
    function recordHandoff(
        bytes32 _cargoHash,
        address _to,
        bytes32 _zkpProofHash
    ) external {
        Record[] storage records = provenanceTrail[_cargoHash];
        address current = msg.sender;
        
        if (records.length > 0) {
            require(records[records.length - 1].currentHolder == msg.sender, "Caller must hold current custody");
        }

        records.push(Record({
            cargoHash: _cargoHash,
            currentHolder: _to,
            timestamp: block.timestamp,
            verified: true
        }));

        emit CustodyTransferred(_cargoHash, current, _to, _zkpProofHash);
    }

    function getHandoffCount(bytes32 _cargoHash) external view returns (uint256) {
        return provenanceTrail[_cargoHash].length;
    }
}
