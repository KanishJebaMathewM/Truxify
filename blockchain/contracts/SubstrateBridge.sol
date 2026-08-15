// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/**
 * @title SubstrateBridge
 * @dev Dynamic EVM-to-Substrate cross-chain bridge verifying XCM transactions.
 */
contract SubstrateBridge is Ownable {
    using ECDSA for bytes32;
    using MessageHashUtils for bytes32;

    mapping(bytes32 => bool) public processedMessages;
    event XcmMessageRelayed(bytes32 indexed messageHash, uint32 destParachainId, address recipient, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /**
     * @dev Relays a tokenized Bill of Lading transfer message to a target Substrate Parachain via XCM payload.
     *      Only the owner may relay, and the caller must present a signature
     *      produced by the owner over the message hash (issue #11988).
     */
    function relayXcmMessage(
        bytes32 _messageHash,
        uint32 _destParachainId,
        address _recipient,
        uint256 _amount,
        bytes calldata _signature
    ) external onlyOwner returns (bool) {
        require(!processedMessages[_messageHash], "Message already processed by bridge");
        require(_signature.length == 65, "Invalid bridge transaction signature");
        require(
            _messageHash.toEthSignedMessageHash().recover(_signature) == owner(),
            "Invalid bridge transaction signature"
        );

        processedMessages[_messageHash] = true;

        emit XcmMessageRelayed(_messageHash, _destParachainId, _recipient, _amount);
        return true;
    }
}
