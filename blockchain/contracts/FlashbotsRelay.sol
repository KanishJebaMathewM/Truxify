// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IFlashbotsRelay {
    function submitBundle(
        bytes[] calldata signedTxs,
        uint256 blockNumber
    ) external returns (bytes32);
}

contract FlashbotsRelay is Ownable, ReentrancyGuard {
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
    ) external onlyOwner nonReentrant returns (bytes32) {
        bytes32 bundleId = keccak256(abi.encode(signedTxs, blockNumber));
        require(!submittedBundles[bundleId], "Bundle already submitted");

        // Effects updated before external interaction (CEI Pattern)
        submittedBundles[bundleId] = true;
        bundleResults[bundleId] = blockNumber;

        bytes32 result = relay.submitBundle(signedTxs, blockNumber);

        emit BundleSubmitted(bundleId, blockNumber);
        emit BundleExecuted(bundleId, true);
        return result;
    }

    function setRelay(address newRelay) external onlyOwner {
        relay = IFlashbotsRelay(newRelay);
    }
}
