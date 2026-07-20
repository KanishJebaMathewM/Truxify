class WalletTransactionFilter {
  final DateTime? startDate;
  final DateTime? endDate;
  final String? txnType;
  final String? status;
  final double? minAmount;
  final double? maxAmount;

  const WalletTransactionFilter({this.startDate, this.endDate, this.txnType, this.status, this.minAmount, this.maxAmount});

  bool matches(WalletTransactionModel txn) {
    if (startDate != null && txn.createdAt.isBefore(startDate!)) return false;
    if (endDate != null && txn.createdAt.isAfter(endDate!)) return false;
    if (txnType != null && txn.txnType != txnType) return false;
    if (status != null && txn.status != status) return false;
    if (minAmount != null && txn.amount < minAmount!) return false;
    if (maxAmount != null && txn.amount > maxAmount!) return false;
    return true;
  }
}

class WalletTransactionModel {
  final String id;
  final String? tripDisplayId;
  final double amount;
  final String txnType;
  final String status;
  final String description;
  final DateTime createdAt;

  WalletTransactionModel({
    required this.id,
    this.tripDisplayId,
    required this.amount,
    required this.txnType,
    required this.status,
    required this.description,
    required this.createdAt,
  });

  factory WalletTransactionModel.fromMap(Map<String, dynamic> map) {
    return WalletTransactionModel(
      id: map['id'],
      tripDisplayId: map['trip_display_id'],
      amount: (map['amount'] ?? 0) / 100.0,
      txnType: map['txn_type'] ?? '',
      status: map['status'] ?? '',
      description: map['description'] ?? '',
      createdAt: DateTime.parse(map['created_at']),
    );
  }
}
