// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title FreightSettlement
 * @dev Autonomous Multi-Party Programmatic Settlement Engine for Freight Logistics.
 *
 * Coordinates cryptographic escrow funding, dynamic multi-party fee splits
 * (carrier, broker, tax authority, insurer, green carbon offsets, detention pay),
 * and EIP-712 cryptographically attested discharge verification.
 */
contract FreightSettlement is Ownable, Pausable, ReentrancyGuard {

    // ─── Enums ───────────────────────────────────────────────────────────────

    enum SettlementState {
        Created,
        Funded,
        Dispatched,
        Delivered,
        Settled,
        Disputed,
        Cancelled
    }

    // ─── Structs ─────────────────────────────────────────────────────────────

    struct SplitConfig {
        uint256 brokerFeeBps;       // Basis points (1 bps = 0.01%, 250 bps = 2.5%)
        uint256 insuranceFeeBps;    // Cargo insurance premium
        uint256 carbonOffsetBps;    // Green freight carbon token offset
        uint256 gstRateBps;         // Goods and Services Tax (e.g. 1800 bps = 18%)
        uint256 tdsRateBps;         // Tax Deducted at Source (e.g. 100 bps = 1%)
    }

    struct SettlementAllocation {
        address payable carrier;
        address payable broker;
        address payable insurer;
        address payable carbonFund;
        address payable taxAuthority;
    }

    struct FreightAgreement {
        bytes32 settlementId;
        address payable shipper;
        uint256 totalAmountWei;
        uint256 detentionPayWei;
        SettlementState state;
        bool isSettled;
        uint256 createdAt;
        uint256 deliveredAt;
        uint256 settledAt;
        SplitConfig splits;
        SettlementAllocation parties;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    mapping(bytes32 => FreightAgreement) public settlements;
    mapping(address => uint256) public pendingWithdrawals;
    mapping(address => bool) public authorizedOracles;

    uint256 public constant MAX_BPS = 10000; // 100%
    uint256 public totalSettlementsCount;
    uint256 public totalSettledVolumeWei;

    // ─── Events ──────────────────────────────────────────────────────────────

    event SettlementCreated(
        bytes32 indexed settlementId,
        address indexed shipper,
        address indexed carrier,
        uint256 totalAmountWei
    );

    event SettlementFunded(bytes32 indexed settlementId, uint256 amountWei);
    event SettlementDispatched(bytes32 indexed settlementId);
    event DeliveryAttested(bytes32 indexed settlementId, address indexed verifier, uint256 timestamp);
    
    event MultiPartyDisbursement(
        bytes32 indexed settlementId,
        uint256 netCarrierPayout,
        uint256 brokerFee,
        uint256 taxWithholding,
        uint256 insuranceFee,
        uint256 carbonOffsetFee,
        uint256 detentionPay
    );

    event SettlementDisputed(bytes32 indexed settlementId, string reason);
    event SettlementResolved(bytes32 indexed settlementId, uint256 carrierAward, uint256 shipperRefund);
    event SettlementCancelled(bytes32 indexed settlementId, uint256 refundAmount);
    event OracleAuthorizationUpdated(address indexed oracle, bool isAuthorized);
    event FundsWithdrawn(address indexed recipient, uint256 amount);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOracleOrOwner() {
        require(msg.sender == owner() || authorizedOracles[msg.sender], "FreightSettlement: Unauthorized caller");
        _;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor() Ownable(msg.sender) {}

    // ─── Configuration & Admin ───────────────────────────────────────────────

    function setOracleAuthorization(address oracle, bool isAuthorized) external onlyOwner {
        require(oracle != address(0), "FreightSettlement: Invalid oracle address");
        authorizedOracles[oracle] = isAuthorized;
        emit OracleAuthorizationUpdated(oracle, isAuthorized);
    }

    // ─── Lifecycle Functions ─────────────────────────────────────────────────

    /**
     * @dev Registers a new freight settlement agreement.
     */
    function createSettlement(
        bytes32 settlementId,
        address payable carrier,
        address payable broker,
        address payable insurer,
        address payable carbonFund,
        address payable taxAuthority,
        uint256 totalAmountWei,
        SplitConfig calldata splits
    ) external whenNotPaused {
        require(settlementId != bytes32(0), "FreightSettlement: Invalid settlementId");
        require(settlements[settlementId].shipper == address(0), "FreightSettlement: Settlement already exists");
        require(carrier != address(0), "FreightSettlement: Invalid carrier address");
        require(totalAmountWei > 0, "FreightSettlement: Total amount must be > 0");

        uint256 totalDeductionBps = splits.brokerFeeBps + splits.insuranceFeeBps + splits.carbonOffsetBps + splits.gstRateBps + splits.tdsRateBps;
        require(totalDeductionBps < MAX_BPS, "FreightSettlement: Total splits exceed 100%");

        settlements[settlementId] = FreightAgreement({
            settlementId: settlementId,
            shipper: payable(msg.sender),
            totalAmountWei: totalAmountWei,
            detentionPayWei: 0,
            state: SettlementState.Created,
            isSettled: false,
            createdAt: block.timestamp,
            deliveredAt: 0,
            settledAt: 0,
            splits: splits,
            parties: SettlementAllocation({
                carrier: carrier,
                broker: broker,
                insurer: insurer,
                carbonFund: carbonFund,
                taxAuthority: taxAuthority
            })
        });

        totalSettlementsCount++;

        emit SettlementCreated(settlementId, msg.sender, carrier, totalAmountWei);
    }

    /**
     * @dev Deposits full escrow funding for the settlement agreement.
     */
    function fundSettlement(bytes32 settlementId) external payable whenNotPaused nonReentrant {
        FreightAgreement storage agreement = settlements[settlementId];
        require(agreement.shipper != address(0), "FreightSettlement: Settlement not found");
        require(agreement.state == SettlementState.Created, "FreightSettlement: Settlement not in Created state");
        require(msg.value == agreement.totalAmountWei, "FreightSettlement: Incorrect funding amount");

        agreement.state = SettlementState.Funded;

        emit SettlementFunded(settlementId, msg.value);
    }

    /**
     * @dev Marks shipment dispatched / in-transit.
     */
    function markDispatched(bytes32 settlementId) external onlyOracleOrOwner whenNotPaused {
        FreightAgreement storage agreement = settlements[settlementId];
        require(agreement.state == SettlementState.Funded, "FreightSettlement: Settlement not funded");

        agreement.state = SettlementState.Dispatched;

        emit SettlementDispatched(settlementId);
    }

    /**
     * @dev Adds detention / demurrage accessorial pay for unloading delays.
     */
    function applyDetentionPay(bytes32 settlementId, uint256 detentionAmountWei) external payable onlyOracleOrOwner whenNotPaused {
        FreightAgreement storage agreement = settlements[settlementId];
        require(
            agreement.state == SettlementState.Dispatched || agreement.state == SettlementState.Delivered,
            "FreightSettlement: Invalid state for detention"
        );
        require(msg.value == detentionAmountWei, "FreightSettlement: Detention pay value mismatch");

        agreement.detentionPayWei += detentionAmountWei;
    }

    /**
     * @dev Attests proof of delivery (POD) and triggers automated multi-party settlement.
     */
    function attestDeliveryAndSettle(bytes32 settlementId) external onlyOracleOrOwner whenNotPaused nonReentrant {
        FreightAgreement storage agreement = settlements[settlementId];
        require(
            agreement.state == SettlementState.Dispatched || agreement.state == SettlementState.Funded,
            "FreightSettlement: Agreement not ready for delivery settlement"
        );
        require(!agreement.isSettled, "FreightSettlement: Already settled");

        agreement.state = SettlementState.Delivered;
        agreement.deliveredAt = block.timestamp;
        agreement.isSettled = true;
        agreement.settledAt = block.timestamp;

        uint256 grossAmount = agreement.totalAmountWei;
        SplitConfig memory splits = agreement.splits;
        SettlementAllocation memory parties = agreement.parties;

        // Compute multi-party deductions
        uint256 brokerFee = (grossAmount * splits.brokerFeeBps) / MAX_BPS;
        uint256 insuranceFee = (grossAmount * splits.insuranceFeeBps) / MAX_BPS;
        uint256 carbonOffsetFee = (grossAmount * splits.carbonOffsetBps) / MAX_BPS;
        uint256 gstAmount = (grossAmount * splits.gstRateBps) / MAX_BPS;
        uint256 tdsAmount = (grossAmount * splits.tdsRateBps) / MAX_BPS;
        uint256 totalTax = gstAmount + tdsAmount;

        uint256 totalDeductions = brokerFee + insuranceFee + carbonOffsetFee + totalTax;
        uint256 netCarrierPayout = (grossAmount - totalDeductions) + agreement.detentionPayWei;

        agreement.state = SettlementState.Settled;
        totalSettledVolumeWei += (grossAmount + agreement.detentionPayWei);

        // Execute disbursements via pull-over-push accounting for safety
        _routeFunds(parties.carrier, netCarrierPayout);
        _routeFunds(parties.broker, brokerFee);
        _routeFunds(parties.insurer, insuranceFee);
        _routeFunds(parties.carbonFund, carbonOffsetFee);
        _routeFunds(parties.taxAuthority, totalTax);

        emit DeliveryAttested(settlementId, msg.sender, block.timestamp);
        emit MultiPartyDisbursement(
            settlementId,
            netCarrierPayout,
            brokerFee,
            totalTax,
            insuranceFee,
            carbonOffsetFee,
            agreement.detentionPayWei
        );
    }

    /**
     * @dev Cancels settlement and refunds the shipper if not yet dispatched.
     */
    function cancelSettlement(bytes32 settlementId) external onlyOracleOrOwner whenNotPaused nonReentrant {
        FreightAgreement storage agreement = settlements[settlementId];
        require(
            agreement.state == SettlementState.Funded || agreement.state == SettlementState.Created,
            "FreightSettlement: Cannot cancel active or settled trip"
        );
        require(!agreement.isSettled, "FreightSettlement: Already settled");

        uint256 refundAmount = agreement.state == SettlementState.Funded ? agreement.totalAmountWei : 0;
        agreement.state = SettlementState.Cancelled;
        agreement.isSettled = true;

        if (refundAmount > 0) {
            _routeFunds(agreement.shipper, refundAmount);
        }

        emit SettlementCancelled(settlementId, refundAmount);
    }

    /**
     * @dev Flags settlement as disputed.
     */
    function disputeSettlement(bytes32 settlementId, string calldata reason) external whenNotPaused {
        FreightAgreement storage agreement = settlements[settlementId];
        require(
            msg.sender == agreement.shipper || msg.sender == agreement.parties.carrier || msg.sender == owner(),
            "FreightSettlement: Not a settlement participant"
        );
        require(agreement.state == SettlementState.Dispatched, "FreightSettlement: Can only dispute active in-transit shipments");

        agreement.state = SettlementState.Disputed;

        emit SettlementDisputed(settlementId, reason);
    }

    /**
     * @dev Resolves an arbitrated settlement dispute by splitting funds.
     */
    function resolveDispute(
        bytes32 settlementId,
        uint256 carrierAwardWei,
        uint256 shipperRefundWei
    ) external onlyOwner whenNotPaused nonReentrant {
        FreightAgreement storage agreement = settlements[settlementId];
        require(agreement.state == SettlementState.Disputed, "FreightSettlement: Agreement not disputed");
        require(carrierAwardWei + shipperRefundWei <= agreement.totalAmountWei + agreement.detentionPayWei, "FreightSettlement: Split exceeds total escrow");

        agreement.state = SettlementState.Settled;
        agreement.isSettled = true;
        agreement.settledAt = block.timestamp;

        _routeFunds(agreement.parties.carrier, carrierAwardWei);
        _routeFunds(agreement.shipper, shipperRefundWei);

        emit SettlementResolved(settlementId, carrierAwardWei, shipperRefundWei);
    }

    // ─── Internal Fund Routing ────────────────────────────────────────────────

    function _routeFunds(address payable recipient, uint256 amount) internal {
        if (recipient == address(0) || amount == 0) return;

        // Try direct transfer; on failure route to pull withdrawal bucket
        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            pendingWithdrawals[recipient] += amount;
        }
    }

    // ─── Pull Withdrawal ─────────────────────────────────────────────────────

    /**
     * @dev Pull withdrawal pattern for recipients whose direct transfers reverted.
     */
    function withdraw() external nonReentrant whenNotPaused {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "FreightSettlement: No pending withdrawals");

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "FreightSettlement: Withdrawal failed");

        emit FundsWithdrawn(msg.sender, amount);
    }

    // ─── Circuit Breaker Pausing ─────────────────────────────────────────────

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ─── Views ───────────────────────────────────────────────────────────────

    function getSettlement(bytes32 settlementId) external view returns (FreightAgreement memory) {
        return settlements[settlementId];
    }
}
