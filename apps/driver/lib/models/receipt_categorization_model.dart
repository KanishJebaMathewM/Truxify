class ExpenseReceipt {
  final String id;
  final String vendorName;
  final double amount;
  final String category; // "Fuel", "Repairs", "Tolls", "Meals", "Uncategorized"
  final String taxStatus; // "Tax Deductible", "Non-Deductible"
  final DateTime dateScanned;

  ExpenseReceipt({
    required this.id,
    required this.vendorName,
    required this.amount,
    required this.category,
    required this.taxStatus,
    required this.dateScanned,
  });
}

class ReceiptCategorizationSession {
  final String status;
  final bool isScanning;
  final List<ExpenseReceipt> categorizedExpenses;
  final double totalDeductible;

  ReceiptCategorizationSession({
    required this.status,
    required this.isScanning,
    required this.categorizedExpenses,
    required this.totalDeductible,
  });
}
