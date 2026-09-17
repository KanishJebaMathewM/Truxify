// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title ZKCP (Zero-Knowledge Contingent Payments)
 * @author Truxify Protocol Engineering
 * @notice Smart contract for Zero-Knowledge Contingent Payments on Polygon.
 * Facilitates atomic, trustless buy-sell transactions for encrypted route optimization datasets,
 * ensuring absolute cryptographic contingency where payment is strictly released only upon 
 * valid decryption key revelation matching the committed dataset hash.
 */
contract ZKCP is Ownable {

    /// @notice Custom errors for gas efficiency and precise revert reasons
    error AgreementAlreadyExists(bytes32 agreementId);
    error AgreementNotFound(bytes32 agreementId);
    error AgreementAlreadyCompleted(bytes32 agreementId);
    error InvalidLockedValue();
    error UnauthorizedSeller(address caller);
    error UnauthorizedBuyer(address caller);
    error CommitmentMismatch();
    error TimelockNotExpired(uint256 currentTimestamp, uint256 requiredTimestamp);
    error KeyAlreadyRevealed();
    error TransferFailed();

    /**
     * @struct EscrowAgreement
     * @notice Core data structure holding state for each individual zero-knowledge escrow transaction.
     */
    struct EscrowAgreement {
        address buyer;
        address seller;
        uint256 amount;
        bytes32 dataHashCommitment;
        uint256 refundTimelock;
        bool keyRevealed;
        bool completed;
        uint256 createdAt;
    }

    /// @notice Mapping from unique agreement identifier to its respective EscrowAgreement struct
    mapping(bytes32 => EscrowAgreement) public agreements;

    /// @notice Mapping to track active agreement counts per participant
    mapping(address => uint256) public userAgreementCount;

    /// @notice Emitted when a buyer locks payment into the escrow contract
    event PaymentLocked(
        bytes32 indexed agreementId, 
        address indexed buyer, 
        address indexed seller, 
        uint256 amount,
        bytes32 dataHashCommitment,
        uint256 refundTimelock
    );

    /// @notice Emitted when the seller successfully claims payment by revealing the valid decryption key and dataset hash
    event PaymentReleased(
        bytes32 indexed agreementId, 
        bytes32 decryptionKey,
        bytes32 actualDataHash,
        address indexed seller,
        uint256 payoutAmount
    );

    /// @notice Emitted when a buyer reclaims funds after the refund timelock expires without key revelation
    event BuyerRefunded(
        bytes32 indexed agreementId,
        address indexed buyer,
        uint256 refundedAmount
    );

    /**
     * @notice Contract constructor setting the initial contract owner
     */
    constructor() Ownable(msg.sender) {}

    /**
     * @notice Locks payment in escrow for a trustless ZKCP trade
     * @param _agreementId Unique cryptographic hash identifying the transaction agreement
     * @param _seller Address of the dataset vendor/seller
     * @param _dataHashCommitment Cryptographic commitment sha256(abi.encodePacked(decryptionKey, actualDataHash))
     * @param _refundDuration Duration in seconds before the buyer can trigger a timeout refund
     */
    function lockPayment(
        bytes32 _agreementId,
        address _seller,
        bytes32 _dataHashCommitment,
        uint256 _refundDuration
    ) external payable {
     if (msg.value == 0) revert InvalidLockedValue();
        if (_dataHashCommitment == bytes32(0)) revert CommitmentMismatch();
        if (agreements[_agreementId].buyer != address(0)) revert AgreementAlreadyExists(_agreementId);

        uint256 timelockExpiry = block.timestamp + _refundDuration;

        agreements[_agreementId] = EscrowAgreement({
            buyer: msg.sender,
            seller: _seller,
            amount: msg.value,
            dataHashCommitment: _dataHashCommitment,
            refundTimelock: timelockExpiry,
            keyRevealed: false,
            completed: false,
            createdAt: block.timestamp
        });

        userAgreementCount[msg.sender]++;
        userAgreementCount[_seller]++;

        emit PaymentLocked(
            _agreementId, 
            msg.sender, 
            _seller, 
            msg.value, 
            _dataHashCommitment, 
            timelockExpiry
        );
    }

    /**
     * @notice Releases escrow funds atomically to the seller upon verifying the decryption key and dataset binding (#14779)
     * @param _agreementId Unique agreement identifier
     * @param _decryptionKey Secret cryptographic decryption key for the dataset
     * @param _actualDataHash Hash of the delivered dataset payload ensuring true data delivery contingency
     */
    function claimPayment(
        bytes32 _agreementId, 
        bytes32 _decryptionKey, 
        bytes32 _actualDataHash
    ) external {
        EscrowAgreement storage agreement = agreements[_agreementId];
        
        if (agreement.buyer == address(0)) revert AgreementNotFound(_agreementId);
        if (agreement.completed) revert AgreementAlreadyCompleted(_agreementId);
        if (msg.sender != agreement.seller) revert UnauthorizedSeller(msg.sender);

        // Cryptographically bind the decryption key and data hash to enforce true ZKCP data delivery contingency (#14779)
        bytes32 derivedCommitment = sha256(abi.encodePacked(_decryptionKey, _actualDataHash));
        if (derivedCommitment != agreement.dataHashCommitment) revert CommitmentMismatch();

        agreement.keyRevealed = true;
        agreement.completed = true;

        uint256 payout = agreement.amount;
        
        (bool success, ) = payable(agreement.seller).call{value: payout}("");
        if (!success) revert TransferFailed();

        emit PaymentReleased(_agreementId, _decryptionKey, _actualDataHash, msg.sender, payout);
    }

    /**
     * @notice Allows the buyer to reclaim escrow funds if the seller fails to deliver the key before timelock expiry
     * @param _agreementId Unique agreement identifier
     */
    function refundBuyer(bytes32 _agreementId) external {
        EscrowAgreement storage agreement = agreements[_agreementId];
        
        if (agreement.buyer == address(0)) revert AgreementNotFound(_agreementId);
        if (agreement.completed) revert AgreementAlreadyCompleted(_agreementId);
        if (msg.sender != agreement.buyer) revert UnauthorizedBuyer(msg.sender);
        if (agreement.keyRevealed) revert KeyAlreadyRevealed();
        if (block.timestamp < agreement.refundTimelock) {
            revert TimelockNotExpired(block.timestamp, agreement.refundTimelock);
        }

        agreement.completed = true;
        uint256 refundAmount = agreement.amount;

        (bool success, ) = payable(agreement.buyer).call{value: refundAmount}("");
        if (!success) revert TransferFailed();

        emit BuyerRefunded(_agreementId, msg.sender, refundAmount);
    }

    /**
     * @notice Helper view function to inspect full agreement details
     * @param _agreementId Unique agreement identifier
     */
    function getAgreementDetails(bytes32 _agreementId) external view returns (
        address buyer,
        address seller,
        uint256 amount,
        bytes32 dataHashCommitment,
        uint256 refundTimelock,
        bool keyRevealed,
        bool completed,
        uint256 createdAt
    ) {
        EscrowAgreement memory agreement = agreements[_agreementId];
        if (agreement.buyer == address(0)) revert AgreementNotFound(_agreementId);
        
        return (
            agreement.buyer,
            agreement.seller,
            agreement.amount,
            agreement.dataHashCommitment,
            agreement.refundTimelock,
            agreement.keyRevealed,
            agreement.completed,
            agreement.createdAt
        );
    }

    /**
     * @notice Emergency administrative function to check contract balance
     */
    function getContractBalance() external view returns (uint256) {
        return address(this).balance;
    }
}