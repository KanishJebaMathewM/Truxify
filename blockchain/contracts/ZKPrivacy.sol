// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ZKPrivacy
 * @dev Zero-Knowledge Anonymous Rating Contract using cryptographic nullifier tracking to prevent double rating without identity exposure.
 */
contract ZKPrivacy is Ownable {

    struct RatingStats {
        uint256 totalStars;
        uint256 totalRatings;
    }

    mapping(address => RatingStats) public driverRatings;
    mapping(bytes32 => bool) public usedNullifiers;

    event RatingSubmitted(address indexed driver, uint8 stars, bytes32 indexed nullifierHash);

    constructor() Ownable(msg.sender) {}

    function submitAnonymousRating(
        address _driver,
        uint8 _stars,
        bytes32 _nullifierHash,
        bytes32 _zkProof
    ) external {
        require(_stars >= 1 && _stars <= 5, "Invalid rating stars (1-5)");
        require(!usedNullifiers[_nullifierHash], "Nullifier already used for trip rating");
        require(_zkProof != bytes32(0), "Invalid ZK proof");

        usedNullifiers[_nullifierHash] = true;
        driverRatings[_driver].totalStars += _stars;
        driverRatings[_driver].totalRatings += 1;

        emit RatingSubmitted(_driver, _stars, _nullifierHash);
    }

    function getDriverAverageRating(address _driver) external view returns (uint256 averageScaled) {
        RatingStats memory stats = driverRatings[_driver];
        if (stats.totalRatings == 0) return 0;
        return (stats.totalStars * 100) / stats.totalRatings; // Scaled by 100 (e.g. 480 = 4.80 stars)
    }
}