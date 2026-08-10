// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title AssetToken
 * @dev ERC-1155 Multi-Token Assetization for Digital Bills of Lading on Polygon.
 */
contract AssetToken is ERC1155, Ownable {

    mapping(uint256 => bytes32) public documentHashes;
    mapping(uint256 => string) public tokenURIs;

    event FreightAssetTokenized(uint256 indexed tokenId, address indexed shipper, uint256 amount, bytes32 documentHash);

    constructor() ERC1155("https://api.truxify.com/metadata/{id}.json") Ownable(msg.sender) {}

    function mintBillOfLadingToken(
        address _to,
        uint256 _tokenId,
        uint256 _amount,
        bytes32 _documentHash,
        string calldata _uri
    ) external onlyOwner {
        require(documentHashes[_tokenId] == bytes32(0), "Token ID already exists");

        documentHashes[_tokenId] = _documentHash;
        tokenURIs[_tokenId] = _uri;

        _mint(_to, _tokenId, _amount, "");
        emit FreightAssetTokenized(_tokenId, _to, _amount, _documentHash);
    }

    function uri(uint256 _tokenId) public view override returns (string memory) {
        return tokenURIs[_tokenId];
    }
}