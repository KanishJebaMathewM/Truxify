// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

// Snark verification interface or helper (assuming standard pairing/verifier layout)
interface IVerifier {
    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) external view returns (bool);
}

contract DriverQualificationVerifier is Ownable, IVerifier {
    address public zkVerifierContract;

    event QualificationVerified(address indexed driver, bool isValid);

    constructor(address _zkVerifier) Ownable(msg.sender) {
        zkVerifierContract = _zkVerifier;
    }

    function setVerifier(address _zkVerifier) external onlyOwner {
        zkVerifierContract = _zkVerifier;
    }

    function verifyProof(
        uint256[2] memory a,
        uint256[2][2] memory b,
        uint256[2] memory c,
        uint256[1] memory input
    ) public view override returns (bool) {
        // Calls external zkSNARK verifier contract
        (bool success, bytes memory data) = zkVerifierContract.staticcall(
            abi.encodeWithSignature("verifyProof(uint256[2],uint256[2][2],uint256[2],uint256[1])", a, b, c, input)
        );
        require(success, "Verifier call failed");
        return abi.decode(data, (bool));
    }

    function checkDriverQualification(
        address driver,
        uint256[2] memory a,
        uint256[4] memory flatB,
        uint256[2] memory c,
        uint256[1] memory input
    ) external returns (bool) {
        // Convert flat uint256[4] proof array 'b' into 2x2 matrix format required by verifiers
        uint256[2][2] memory b = [
            [flatB[0], flatB[1]],
            [flatB[2], flatB[3]]
        ];

        bool isValid = verifyProof(a, b, c, input);
        emit QualificationVerified(driver, isValid);
        return isValid;
    }
}