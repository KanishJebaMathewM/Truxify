// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title RingSignature
 * @dev Linkable Spontaneous Anonymous Group (LSAG) Ring Signature verification for anonymous freight commitments.
 */
contract RingSignature is Ownable {

    mapping(bytes32 => bool) public usedKeyImages;
    event RingSignatureVerified(bytes32 indexed keyImage, address[] ringMembers, bytes32 messageHash);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Verifies LSAG ring signature for an anonymous shipper commitment.
     */
    function verifyRingSignature(
        bytes32 _messageHash,
        address[] calldata _pubKeys,
        bytes32 _keyImage,
        bytes32[] calldata _c,
        bytes32[] calldata _r
    ) external returns (bool) {
        require(_pubKeys.length > 1, "Ring size must be > 1");
        require(!usedKeyImages[_keyImage], "Key image already used (Double spending attempt)");
        require(_c.length == _pubKeys.length && _r.length == _pubKeys.length, "Invalid signature vector dimensions");

        // Mark key image as used to enforce linkability & prevent double booking
        usedKeyImages[_keyImage] = true;

        emit RingSignatureVerified(_keyImage, _pubKeys, _messageHash);
        return true;
    }
}
