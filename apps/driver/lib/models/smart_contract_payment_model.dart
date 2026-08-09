class SmartContractPayment {
  final String contractId;
  final String loadId;
  final String brokerName;
  final double amountUsd;
  final String cryptoEquivalent; // e.g., '1450.00 USDC'
  final bool geoFenceBreached;
  final bool bolSigned;
  final String status; // 'Awaiting Delivery', 'Executing', 'Settled'
  final DateTime? settlementTime;

  SmartContractPayment({
    required this.contractId,
    required this.loadId,
    required this.brokerName,
    required this.amountUsd,
    required this.cryptoEquivalent,
    required this.geoFenceBreached,
    required this.bolSigned,
    required this.status,
    this.settlementTime,
  });
}
