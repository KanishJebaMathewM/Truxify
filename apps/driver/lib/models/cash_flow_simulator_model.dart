class FinancialEvent {
  final String description;
  final double amount;
  final DateTime estimatedDate;
  final bool isExpense;
  final String? associatedBroker;

  FinancialEvent({
    required this.description,
    required this.amount,
    required this.estimatedDate,
    required this.isExpense,
    this.associatedBroker,
  });
}

class CashFlowSession {
  final String status;
  final double startingBalance;
  final List<FinancialEvent> projectedEvents;
  final double minimumProjectedBalance;
  final bool hasOverdraftRisk;

  CashFlowSession({
    required this.status,
    required this.startingBalance,
    required this.projectedEvents,
    required this.minimumProjectedBalance,
    required this.hasOverdraftRisk,
  });
}
