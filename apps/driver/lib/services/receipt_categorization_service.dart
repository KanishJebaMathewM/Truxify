import 'dart:async';
import '../models/receipt_categorization_model.dart';

class ReceiptCategorizationService {
  final _sessionController = StreamController<ReceiptCategorizationSession>.broadcast();
  final List<ExpenseReceipt> _expenses = [];

  Stream<ReceiptCategorizationSession> get categorizationStream => _sessionController.stream;

  void initializeDashboard() {
    _emitState('Awaiting Receipt Upload', false);
  }

  void simulateReceiptUpload() async {
    _emitState('OCR Extracting Text...', true);
    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('NLP Categorizing Vendor...', true);
    await Future.delayed(const Duration(seconds: 1));

    // Create a mock extracted receipt
    final receipt = ExpenseReceipt(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      vendorName: 'Loves Travel Stop #312',
      amount: 450.75,
      category: 'Fuel',
      taxStatus: 'Tax Deductible',
      dateScanned: DateTime.now(),
    );

    _expenses.insert(0, receipt);

    _emitState('Receipt Successfully Categorized', false);
  }
  
  void simulateRepairUpload() async {
    _emitState('OCR Extracting Text...', true);
    await Future.delayed(const Duration(seconds: 1));
    
    _emitState('NLP Categorizing Vendor...', true);
    await Future.delayed(const Duration(seconds: 1));

    // Create a mock extracted receipt
    final receipt = ExpenseReceipt(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      vendorName: 'TA Truck Service',
      amount: 1240.00,
      category: 'Repairs',
      taxStatus: 'Tax Deductible',
      dateScanned: DateTime.now(),
    );

    _expenses.insert(0, receipt);

    _emitState('Receipt Successfully Categorized', false);
  }

  void _emitState(String status, bool isScanning) {
    double total = _expenses
        .where((e) => e.taxStatus == 'Tax Deductible')
        .fold(0.0, (sum, e) => sum + e.amount);

    _sessionController.add(ReceiptCategorizationSession(
      status: status,
      isScanning: isScanning,
      categorizedExpenses: List.from(_expenses),
      totalDeductible: total,
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
