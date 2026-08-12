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

    error NotImplemented();

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Verifies LSAG ring signature for an anonymous shipper commitment.
     *      Genuine LSAG verification is not implemented yet. This function
     *      reverts instead of unconditionally accepting forged signatures.
     */
    function verifyRingSignature(
        bytes32 _messageHash,
        address[] calldata _pubKeys,
        bytes32 _keyImage,
        bytes32[] calldata _c,
        bytes32[] calldata _r
    ) external returns (bool) {
        revert NotImplemented();
    }
}
