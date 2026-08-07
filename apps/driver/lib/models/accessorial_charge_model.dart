class AccessorialCharge {
  final String chargeId;
  final String loadId;
  final String chargeType; // 'Lumper', 'Detention', 'Layover'
  final double amount;
  final String evidenceUrl; // Receipt photo or GPS log
  final String aiStatus; // 'Pending AI Review', 'Approved by AI', 'Requires Manual Audit'
  final String confidenceReason;

  AccessorialCharge({
    required this.chargeId,
    required this.loadId,
    required this.chargeType,
    required this.amount,
    required this.evidenceUrl,
    required this.aiStatus,
    required this.confidenceReason,
  });
}
