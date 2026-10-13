// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test verifier for KYCVerifier tests matching the ZK verifier interface.
contract MockKYCVerifier {
    bool public shouldVerify = true;
    uint256[] private expectedInput;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function setExpectedInput(uint256[] calldata _input) external {
        expectedInput = _input;
    }

    function verifyProof(
        uint[2] memory,
        uint[2][2] memory,
        uint[2] memory,
        uint[] memory input
    ) external view returns (bool) {
        if (!shouldVerify) return false;
        if (expectedInput.length > 0) {
            if (input.length != expectedInput.length) return false;
            for (uint256 i = 0; i < input.length; i++) {
                if (input[i] != expectedInput[i]) return false;
            }
        }
        return true;
    }
}
