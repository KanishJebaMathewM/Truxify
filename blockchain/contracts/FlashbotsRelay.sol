// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";

interface IFlashbotsRelay {
    function submitBundle(
        bytes[] calldata signedTxs,
        uint256 blockNumber
    ) external returns (bytes32);
}

contract FlashbotsRelay is Ownable {
    IFlashbotsRelay public relay;
    mapping(bytes32 => bool) public submittedBundles;
    mapping(bytes32 => uint256) public bundleResults;

    event BundleSubmitted(bytes32 indexed bundleId, uint256 blockNumber);
    event BundleExecuted(bytes32 indexed bundleId, bool success);

    constructor(address _relay) Ownable(msg.sender) {
        relay = IFlashbotsRelay(_relay);
    }

    function submitBundle(
        bytes[] calldata signedTxs,
        uint256 blockNumber
    ) external onlyOwner returns (bytes32) {
        bytes32 bundleId = keccak256(abi.encodePacked(signedTxs, blockNumber));
        require(!submittedBundles[bundleId], "Bundle already submitted");

        bytes32 result = relay.submitBundle(signedTxs, blockNumber);
        submittedBundles[bundleId] = true;
        
        emit BundleSubmitted(bundleId, blockNumber);
        return result;
    }

    function setRelay(address newRelay) external onlyOwner {
        relay = IFlashbotsRelay(newRelay);
    }
}