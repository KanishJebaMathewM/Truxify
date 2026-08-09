import 'package:flutter/material.dart';
import 'dart:async';
import '../models/geofence_expense_model.dart';
import '../services/automated_expense_service.dart';

class ExpenseGeofenceDashboard extends StatefulWidget {
  const ExpenseGeofenceDashboard({super.key});

  @override
  State<ExpenseGeofenceDashboard> createState() => _ExpenseGeofenceDashboardState();
}

class _ExpenseGeofenceDashboardState extends State<ExpenseGeofenceDashboard> {
  final AutomatedExpenseService _expenseService = AutomatedExpenseService();
  StreamSubscription? _subscription;
  final List<GeofenceExpense> _pendingExpenses = [];
  final List<GeofenceExpense> _confirmedExpenses = [];
  bool _isListening = false;

  @override
  void initState() {
    super.initState();
    _startGeofenceListener();
  }

  void _startGeofenceListener() {
    setState(() {
      _isListening = true;
    });
    
    _subscription = _expenseService.listenForGeofenceExpenses().listen((expense) {
      if (mounted) {
        setState(() {
          _pendingExpenses.add(expense);
        });
        _showNewExpenseAlert(expense);
      }
    });
  }

  void _showNewExpenseAlert(GeofenceExpense expense) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('Geofence Triggered: Auto-drafted ${expense.expenseType} expense!'),
        backgroundColor: Colors.blueAccent,
        duration: const Duration(seconds: 3),
      )
    );
  }

  Future<void> _confirmExpense(GeofenceExpense expense) async {
    final success = await _expenseService.confirmAndUploadExpense(expense.expenseId, expense.estimatedAmount, true);
    if (success && mounted) {
      setState(() {
        _pendingExpenses.remove(expense);
        _confirmedExpenses.insert(0, GeofenceExpense(
          expenseId: expense.expenseId,
          locationName: expense.locationName,
          expenseType: expense.expenseType,
          estimatedAmount: expense.estimatedAmount,
          isConfirmed: true,
          detectedAt: expense.detectedAt,
        ));
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Expense synced with Dispatch.'), backgroundColor: Colors.green)
      );
    }
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Auto-Expense Tracker'),
        backgroundColor: Colors.teal[800],
      ),
      backgroundColor: Colors.grey[100],
      body: Column(
        children: [
          Container(
            width: double.infinity,
            color: Colors.teal[50],
            padding: const EdgeInsets.all(16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.location_on, color: _isListening ? Colors.teal : Colors.grey),
                const SizedBox(width: 8),
                Text(
                  _isListening ? 'GPS Geofencing Active' : 'Geofencing Offline',
                  style: TextStyle(color: _isListening ? Colors.teal[800] : Colors.grey, fontWeight: FontWeight.bold),
                )
              ],
            ),
          ),
          
          if (_pendingExpenses.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: const Align(
                alignment: Alignment.centerLeft,
                child: Text('Needs Review', style: TextStyle(fontSize: 18, color: Colors.orange, fontWeight: FontWeight.bold)),
              ),
            ),
            
          ..._pendingExpenses.map((e) => _buildExpenseCard(e, isPending: true)).toList(),
          
          if (_confirmedExpenses.isNotEmpty)
            Padding(
              padding: const EdgeInsets.all(16.0),
              child: const Align(
                alignment: Alignment.centerLeft,
                child: Text('Synced to Dispatch', style: TextStyle(fontSize: 18, color: Colors.green, fontWeight: FontWeight.bold)),
              ),
            ),
            
          Expanded(
            child: ListView.builder(
              itemCount: _confirmedExpenses.length,
              itemBuilder: (context, index) {
                return _buildExpenseCard(_confirmedExpenses[index], isPending: false);
              },
            ),
          )
        ],
      ),
    );
  }

  Widget _buildExpenseCard(GeofenceExpense expense, {required bool isPending}) {
    IconData icon = Icons.receipt;
    if (expense.expenseType == 'TOLL') icon = Icons.toll;
    if (expense.expenseType == 'PARKING') icon = Icons.local_parking;

    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              children: [
                CircleAvatar(backgroundColor: isPending ? Colors.orange[100] : Colors.green[100], child: Icon(icon, color: isPending ? Colors.orange : Colors.green)),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(expense.locationName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                      Text('${expense.detectedAt.hour}:${expense.detectedAt.minute.toString().padLeft(2, '0')}', style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Text('\$${expense.estimatedAmount.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 20)),
              ],
            ),
            if (isPending) ...[
              const SizedBox(height: 16),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton.icon(
                      onPressed: () {}, // Simulated camera launch
                      icon: const Icon(Icons.camera_alt),
                      label: const Text('PHOTO'),
                      style: OutlinedButton.styleFrom(foregroundColor: Colors.teal[800]),
                    ),
                  ),
                  const SizedBox(width: 16),
                  Expanded(
                    child: ElevatedButton.icon(
                      onPressed: () => _confirmExpense(expense),
                      icon: const Icon(Icons.check),
                      label: const Text('CONFIRM'),
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.teal[800], foregroundColor: Colors.white),
                    ),
                  ),
                ],
              )
            ]
          ],
        ),
      ),
    );
  }
}
