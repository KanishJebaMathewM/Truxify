function relayXcmMessage(
    bytes32 _messageHash,
    uint32 _destParachainId,
    address _recipient,
    uint256 _amount,
    bytes calldata _signature
) external onlyOwner returns (bool) {
    require(
        !processedMessages[_messageHash],
        "Message already processed by bridge"
    );

    require(
        _signature.length == 65,
        "Invalid bridge transaction signature"
    );

    require(
        keccak256(
            abi.encodePacked(
                _messageHash,
                _destParachainId,
                _recipient,
                _amount
            )
        )
        .toEthSignedMessageHash()
        .recover(_signature) == owner(),
        "Invalid bridge transaction signature"
    );

    processedMessages[_messageHash] = true;

    emit XcmMessageRelayed(
        _messageHash,
        _destParachainId,
        _recipient,
        _amount
    );

    return true;
}
