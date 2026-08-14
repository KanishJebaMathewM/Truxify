// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// @notice Test-only verifier matching ZKPrivacy's IVerifier interface. It
///         accepts a proof only when every public input equals the expected
///         input recorded by the test, so both the valid and the forged paths
///         can be exercised without a real Groth16 proof. Never used in
///         production deployments.
contract MockZKPrivacyVerifier {
    bool public shouldVerify;
    uint256[] private expectedInput;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function setExpectedInput(uint[] calldata _input) external {
        expectedInput = _input;
    }

    function verifyProof(
        uint[2] memory,
        uint[2][2] memory,
        uint[2] memory,
        uint[] memory input
    ) external view returns (bool) {
        if (!shouldVerify) return false;
        if (input.length != expectedInput.length) return false;
        for (uint256 i = 0; i < input.length; i++) {
            if (input[i] != expectedInput[i]) return false;
        }
        return true;
    }
}
