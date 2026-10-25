// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IVerifier {
    function verifyProof(bytes calldata proof, uint256[] calldata publicInputs) external view returns (bool);
}

contract ZKIdentity is Ownable {
    error DIDAlreadyExists(address identity);
    error DIDNotFound(address identity);
    error DIDRevoked(address identity);
    error CredentialAlreadyRevoked(bytes32 nullifierHash);
    error NullifierAlreadySpent(bytes32 nullifierHash);
    error InvalidVerifierAddress();
    error InvalidProofPayload();
    error ProofVerificationFailed();
    error TransferFailed();

    struct DIDDocument {
        string didURI;
        bytes32 credentialMerkleRoot;
        bool isRevoked;
        uint256 registeredAt;
        uint256 lastUpdatedAt;
    }

    address public zkVerifier;
    mapping(address => DIDDocument) public didRegistry;
    mapping(bytes32 => address) public didURIToIdentity;
    mapping(bytes32 => bool) public revokedCredentials;
    mapping(bytes32 => bool) public spentNullifiers;
    mapping(bytes32 => bool) public usedNullifiers;

    event DIDRegistered(address indexed identity, string didURI, bytes32 merkleRoot, uint256 timestamp);
    event DIDUpdated(address indexed identity, string newDidURI, bytes32 newMerkleRoot, uint256 timestamp);
    event CredentialRevoked(bytes32 indexed nullifierHash, address indexed identity, uint256 timestamp);
    event ZKProofVerified(address indexed identity, bytes32 indexed nullifierHash, uint256 timestamp);
    event NullifierConsumed(bytes32 indexed nullifierHash);
    event VerifierUpdated(address indexed oldVerifier, address indexed newVerifier, uint256 timestamp);

    constructor(address _zkVerifier) Ownable(msg.sender) {
        if (_zkVerifier == address(0)) revert InvalidVerifierAddress();
        zkVerifier = _zkVerifier;
    }

    function registerDID(string calldata _didURI, bytes32 _merkleRoot) external {
        if (didRegistry[msg.sender].registeredAt != 0) revert DIDAlreadyExists(msg.sender);
        require(bytes(_didURI).length != 0, "DID URI required");

        string memory expectedDID = string.concat(
            "did:truxify:polygon:0x",
            _addressToLowerHex(msg.sender)
        );
        require(
            keccak256(bytes(_didURI)) == keccak256(bytes(expectedDID)),
            "DID URI must match caller"
        );

        bytes32 didURIHash = keccak256(bytes(_didURI));
        require(didURIToIdentity[didURIHash] == address(0), "DID URI already registered");

        didRegistry[msg.sender] = DIDDocument({
            didURI: _didURI,
            credentialMerkleRoot: _merkleRoot,
            isRevoked: false,
            registeredAt: block.timestamp,
            lastUpdatedAt: block.timestamp
        });
        didURIToIdentity[didURIHash] = msg.sender;
        emit DIDRegistered(msg.sender, _didURI, _merkleRoot, block.timestamp);
    }

    function updateDID(string calldata _newDidURI, bytes32 _newMerkleRoot) external {
        DIDDocument storage doc = didRegistry[msg.sender];
        if (doc.registeredAt == 0) revert DIDNotFound(msg.sender);
        if (doc.isRevoked) revert DIDRevoked(msg.sender);
        doc.didURI = _newDidURI;
        doc.credentialMerkleRoot = _newMerkleRoot;
        doc.lastUpdatedAt = block.timestamp;
        emit DIDUpdated(msg.sender, _newDidURI, _newMerkleRoot, block.timestamp);
    }

    function revokeCredential(bytes32 _credentialHash) external onlyOwner {
        if (revokedCredentials[_credentialHash]) revert CredentialAlreadyRevoked(_credentialHash);
        revokedCredentials[_credentialHash] = true;
        emit CredentialRevoked(_credentialHash, msg.sender, block.timestamp);
    }

    function revokeDID(address _identity) external onlyOwner {
        DIDDocument storage doc = didRegistry[_identity];
        if (doc.registeredAt == 0) revert DIDNotFound(_identity);
        doc.isRevoked = true;
        emit CredentialRevoked(bytes32(0), _identity, block.timestamp);
    }

    function verifyZkProof(
        address _identity,
        bytes calldata _zkProof,
        uint256[] calldata _publicInputs,
        bytes32 _nullifierHash
    ) public view returns (bool) {
        DIDDocument memory doc = didRegistry[_identity];
        if (doc.registeredAt == 0 || doc.isRevoked) return false;
        if (revokedCredentials[_nullifierHash]) return false;
        if (usedNullifiers[_nullifierHash] || spentNullifiers[_nullifierHash]) return false;
        if (_zkProof.length == 0) return false;
        if (zkVerifier == address(0)) return false;
        try IVerifier(zkVerifier).verifyProof(_zkProof, _publicInputs) returns (bool isValid) {
            return isValid;
        } catch {
            return false;
        }
    }

    function verifyAndConsumeZkProof(
        address _identity,
        bytes calldata _zkProof,
        uint256[] calldata _publicInputs,
        bytes32 _nullifierHash
    ) external returns (bool) {
        require(!usedNullifiers[_nullifierHash] && !spentNullifiers[_nullifierHash], "ZKIdentity: nullifier already used");
        require(verifyZkProof(_identity, _zkProof, _publicInputs, _nullifierHash), "ZKIdentity: invalid proof");
        usedNullifiers[_nullifierHash] = true;
        spentNullifiers[_nullifierHash] = true;
        emit NullifierConsumed(_nullifierHash);
        emit ZKProofVerified(_identity, _nullifierHash, block.timestamp);
        return true;
    }

    function updateVerifier(address _newVerifier) external onlyOwner {
        if (_newVerifier == address(0)) revert InvalidVerifierAddress();
        address oldVerifier = zkVerifier;
        zkVerifier = _newVerifier;
        emit VerifierUpdated(oldVerifier, _newVerifier, block.timestamp);
    }

    function getDIDDocument(address _identity) external view returns (
        string memory didURI,
        bytes32 credentialMerkleRoot,
        bool isRevoked,
        uint256 registeredAt,
        uint256 lastUpdatedAt
    ) {
        DIDDocument memory doc = didRegistry[_identity];
        if (doc.registeredAt == 0) revert DIDNotFound(_identity);
        return (doc.didURI, doc.credentialMerkleRoot, doc.isRevoked, doc.registeredAt, doc.lastUpdatedAt);
    }

    function _addressToLowerHex(address account) internal pure returns (string memory) {
        bytes memory alphabet = "0123456789abcdef";
        bytes memory buffer = new bytes(40);
        uint160 value = uint160(account);

        for (uint256 i = 0; i < 20; i++) {
            uint8 currentByte = uint8(value >> (8 * (19 - i)));
            buffer[i * 2] = alphabet[currentByte >> 4];
            buffer[i * 2 + 1] = alphabet[currentByte & 0x0f];
        }

        return string(buffer);
    }
}
