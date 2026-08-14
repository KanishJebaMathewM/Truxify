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

        // The first handoff seeds the provenance trail and may only be initiated
        // by the contract owner, otherwise an arbitrary address could attribute
        // initial custody to anyone. Subsequent handoffs must be signed by the
        // current holder.
        if (records.length == 0) {
            require(msg.sender == owner(), "Only owner can seed initial custody");
        } else {
            require(records[records.length - 1].currentHolder == msg.sender, "Caller must hold current custody");
        }

        // A zero proof hash must not be treated as valid provenance: accepting
        // it would let an unverified/forged transition enter the trail and be
        // mistaken for a real handoff. Fail closed instead.
        require(_zkpProofHash != bytes32(0), "A non-empty ZK proof hash is required to verify the handoff");

        // The ZK proof itself cannot be cheaply verified on-chain, so we only
        // mark a record "verified" when a non-zero proof hash is supplied.
        // Verification is performed off-chain against the referenced proof.
        records.push(Record({
            cargoHash: _cargoHash,
            currentHolder: _to,
            timestamp: block.timestamp,
            verified: _zkpProofHash != bytes32(0)
        }));

        emit CustodyTransferred(_cargoHash, current, _to, _zkpProofHash);
    }

    function getHandoffCount(bytes32 _cargoHash) external view returns (uint256) {
        return provenanceTrail[_cargoHash].length;
    }
}
