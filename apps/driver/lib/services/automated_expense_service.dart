import 'dart:async';
import '../models/geofence_expense_model.dart';

class AutomatedExpenseService {
  /// Simulates a background location service triggering a geofence
  /// entry event for a known toll plaza or paid facility.
  Stream<GeofenceExpense> listenForGeofenceExpenses() async* {
    // Wait for the app to initialize the map
    await Future.delayed(const Duration(seconds: 4));

    // Simulate hitting a toll geofence
    yield GeofenceExpense(
      expenseId: 'EXP-${DateTime.now().millisecondsSinceEpoch}',
      locationName: 'Pennsylvania Turnpike - Breezewood',
      expenseType: 'TOLL',
      estimatedAmount: 34.50, // Typical Class 8 truck toll
      detectedAt: DateTime.now(),
    );

    // Wait a bit, then simulate hitting a truck stop geofence
    await Future.delayed(const Duration(seconds: 8));

    yield GeofenceExpense(
      expenseId: 'EXP-${DateTime.now().millisecondsSinceEpoch}',
      locationName: 'TA Travel Center - Paid Parking',
      expenseType: 'PARKING',
      estimatedAmount: 20.00,
      detectedAt: DateTime.now(),
    );
  }

  /// Simulates confirming and uploading the expense to the dispatcher's system
  Future<bool> confirmAndUploadExpense(String expenseId, double finalAmount, bool hasReceipt) async {
    await Future.delayed(const Duration(seconds: 1));
    return true;
  }
}
