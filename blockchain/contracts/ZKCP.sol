// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ZKCP
 * @dev Smart contract for Zero-Knowledge Contingent Payments (ZKCP) on Polygon.
 * Facilitates atomic, trustless buy-sell transactions for encrypted route optimization datasets.
 */
contract ZKCP is Ownable {

    struct EscrowAgreement {
        address buyer;
        address seller;
        uint256 amount;
        bytes32 dataHashCommitment;
        uint256 refundTimelock;
        bool keyRevealed;
        bool completed;
    }

    mapping(bytes32 => EscrowAgreement) public agreements;

    event PaymentLocked(bytes32 indexed agreementId, address buyer, address seller, uint256 amount);
    event PaymentReleased(bytes32 indexed agreementId, bytes32 decryptionKey);
    event BuyerRefunded(bytes32 indexed agreementId);

    constructor() Ownable(msg.sender) {}

    function lockPayment(
        bytes32 _agreementId,
        address _seller,
        bytes32 _dataHashCommitment,
        uint256 _refundDuration
    ) external payable {
        require(msg.value > 0, "Locked value must be > 0");
        require(agreements[_agreementId].buyer == address(0), "Agreement ID already exists");

        agreements[_agreementId] = EscrowAgreement({
            buyer: msg.sender,
            seller: _seller,
            amount: msg.value,
            dataHashCommitment: _dataHashCommitment,
            refundTimelock: block.timestamp + _refundDuration,
            completed: false
        });

        emit PaymentLocked(_agreementId, msg.sender, _seller, msg.value);
    }

    /**
     * @dev Release payment atomically if decryption key matches ZK hash commitment
     */
    function claimPayment(bytes32 _agreementId, bytes32 _decryptionKey) external {
        EscrowAgreement storage agreement = agreements[_agreementId];
        require(!agreement.completed, "Agreement already completed");
        require(msg.sender == agreement.seller, "Only seller can claim");

        // Verify cryptographic commitment matches key
        bytes32 derivedHash = sha256(abi.encodePacked(_decryptionKey));
        require(derivedHash == agreement.dataHashCommitment, "Decryption key mismatch");

        agreement.keyRevealed = true;
        agreement.completed = true;
        payable(agreement.seller).transfer(agreement.amount);

        emit PaymentReleased(_agreementId, _decryptionKey);
    }

    function refundBuyer(bytes32 _agreementId) external {
        EscrowAgreement storage agreement = agreements[_agreementId];
        require(!agreement.completed, "Agreement already completed");
        require(msg.sender == agreement.buyer, "Only buyer can refund");
        require(!agreement.keyRevealed, "Cannot refund after key revealed");
        require(block.timestamp >= agreement.refundTimelock, "Timelock not expired");

        agreement.completed = true;
        payable(agreement.buyer).transfer(agreement.amount);

        emit BuyerRefunded(_agreementId);
    }
}
