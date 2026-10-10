// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ICircomVerifier {
    function verifyProof(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[1] memory input
    ) external view returns (bool r);
}

contract DriverCredentialVerifier {
    address public owner;
    address public circomVerifier;

    mapping(address => bool) public isDriverVerified;
    mapping(address => uint256) public driverVerificationTimestamp;

    event DriverVerified(address indexed driver, uint256 timestamp);

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can execute");
        _;
    }

    constructor(address _circomVerifier) {
        owner = msg.sender;
        circomVerifier = _circomVerifier;
    }

    function verifyAndMintSBT(
        uint[2] memory a,
        uint[2][2] memory b,
        uint[2] memory c,
        uint[1] memory input
    ) external returns (bool) {
        require(!isDriverVerified[msg.sender], "Driver already verified");

        bool valid = ICircomVerifier(circomVerifier).verifyProof(a, b, c, input);
        require(valid, "Invalid Zero-Knowledge Proof");

        isDriverVerified[msg.sender] = true;
        driverVerificationTimestamp[msg.sender] = block.timestamp;

        emit DriverVerified(msg.sender, block.timestamp);
        return true;
    }

    function updateVerifier(address _newVerifier) external onlyOwner {
        circomVerifier = _newVerifier;
    }
}