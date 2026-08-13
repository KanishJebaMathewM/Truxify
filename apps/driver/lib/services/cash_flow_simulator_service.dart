import 'dart:async';
import '../models/cash_flow_simulator_model.dart';

class CashFlowSimulatorService {
  final _sessionController = StreamController<CashFlowSession>.broadcast();
  
  Stream<CashFlowSession> get cashFlowStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Financial Simulation', 1500.0, [], 1500.0, false);
  }

  void runSimulation() async {
    _emitState('Aggregating Accounts Payable...', 1500.0, [], 1500.0, false);

    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('Calculating Broker "Days to Pay" History...', 1500.0, [], 1500.0, false);

    await Future.delayed(const Duration(seconds: 1));

    DateTime today = DateTime.now();
    
    List<FinancialEvent> events = [
      FinancialEvent(description: 'Diesel Fuel (Estimated)', amount: 650.0, estimatedDate: today.add(const Duration(days: 2)), isExpense: true),
      FinancialEvent(description: 'Truck Insurance Premium', amount: 1200.0, estimatedDate: today.add(const Duration(days: 4)), isExpense: true),
      // This payment is historically slow
      FinancialEvent(description: 'Load LD-409 Payment', amount: 2400.0, estimatedDate: today.add(const Duration(days: 7)), isExpense: false, associatedBroker: 'MegaLogistics Inc (Avg 30 Days)'),
    ];

    // Calculate minimum balance to find overdraft risks
    double currentBal = 1500.0;
    double minBal = currentBal;
    
    for (var e in events) {
      if (e.isExpense) {
        currentBal -= e.amount;
      } else {
        currentBal += e.amount;
      }
      if (currentBal < minBal) {
        minBal = currentBal;
      }
    }

    _emitState('Simulation Complete', 1500.0, events, minBal, minBal < 0);
  }

  void _emitState(String status, double startingBal, List<FinancialEvent> events, double minBal, bool risk) {
    _sessionController.add(CashFlowSession(
      status: status,
      startingBalance: startingBal,
      projectedEvents: List.from(events),
      minimumProjectedBalance: minBal,
      hasOverdraftRisk: risk,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
