// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test-only STARK verifier matching ZKPrivacy's ISTARKVerifier
///         interface. Accepts a proof only when the test enabled verification,
///         so both the valid and the forged paths can be exercised without a
///         real STARK verifier. Never used in production deployments.
contract MockZKPrivacyStarkVerifier {
    bool public shouldVerify;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function verifyProof(
        uint256[] calldata,
        bytes calldata
    ) external view returns (bool) {
        return shouldVerify;
    }
}
