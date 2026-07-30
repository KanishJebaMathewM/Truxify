class GeofenceExpense {
  final String expenseId;
  final String locationName; // e.g. 'I-95 Toll Plaza'
  final String expenseType; // 'TOLL', 'PARKING', 'LUMPER'
  final double estimatedAmount;
  final bool isConfirmed;
  final String receiptPhotoUrl;
  final DateTime detectedAt;

  GeofenceExpense({
    required this.expenseId,
    required this.locationName,
    required this.expenseType,
    required this.estimatedAmount,
    this.isConfirmed = false,
    this.receiptPhotoUrl = '',
    required this.detectedAt,
  });
}
