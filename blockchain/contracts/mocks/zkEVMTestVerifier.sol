// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

contract zkEVMTestVerifier {
    function verifyProof(
        uint[2] memory,
        uint[2][2] memory,
        uint[2] memory,
        uint[2] memory
    ) external pure returns (bool) {
        return true;
    }
}