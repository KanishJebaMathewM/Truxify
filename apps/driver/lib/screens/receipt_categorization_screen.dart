import 'package:flutter/material.dart';
import '../models/receipt_categorization_model.dart';
import '../services/receipt_categorization_service.dart';

class ReceiptCategorizationScreen extends StatefulWidget {
  const ReceiptCategorizationScreen({super.key});

  @override
  State<ReceiptCategorizationScreen> createState() => _ReceiptCategorizationScreenState();
}

class _ReceiptCategorizationScreenState extends State<ReceiptCategorizationScreen> {
  final ReceiptCategorizationService _service = ReceiptCategorizationService();
  ReceiptCategorizationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.categorizationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeDashboard();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Expense AI'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isScanning == true ? null : () => _showUploadOptions(context),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.camera_alt),
        label: const Text('Scan Receipt'),
      ),
    );
  }
  
  void _showUploadOptions(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              ListTile(
                leading: const Icon(Icons.local_gas_station),
                title: const Text('Simulate Fuel Receipt'),
                onTap: () {
                  Navigator.pop(context);
                  _service.simulateReceiptUpload();
                },
              ),
              ListTile(
                leading: const Icon(Icons.build),
                title: const Text('Simulate Repair Invoice'),
                onTap: () {
                  Navigator.pop(context);
                  _service.simulateRepairUpload();
                },
              ),
            ],
          ),
        );
      }
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildTaxSummaryCard(s.totalDeductible),
              const SizedBox(height: 24),
              const Text('ACCOUNTING LEDGER', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.categorizedExpenses.isEmpty)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('No expenses logged. Tap Scan Receipt to begin.', style: TextStyle(color: Colors.grey)),
                ))
              else
                ...s.categorizedExpenses.map((e) => _buildExpenseCard(e)),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(ReceiptCategorizationSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isScanning ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isScanning 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.account_balance_wallet, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('AI CATEGORIZATION', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTaxSummaryCard(double total) {
    return Card(
      elevation: 4,
      color: Colors.green[50],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.green[300]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            const Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.shield, color: Colors.green),
                    SizedBox(width: 8),
                    Text('Est. Tax Deductions', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                  ],
                ),
                SizedBox(height: 4),
                Text('YTD Tracked', style: TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Text('\$${total.toStringAsFixed(2)}', style: TextStyle(color: Colors.green[800], fontSize: 28, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }

  Widget _buildExpenseCard(ExpenseReceipt e) {
    IconData catIcon;
    Color catColor;

    switch (e.category) {
      case 'Fuel':
        catIcon = Icons.local_gas_station;
        catColor = Colors.orange;
        break;
      case 'Repairs':
        catIcon = Icons.build;
        catColor = Colors.red;
        break;
      default:
        catIcon = Icons.receipt;
        catColor = Colors.blueGrey;
    }

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: catColor.withOpacity(0.2),
          child: Icon(catIcon, color: catColor),
        ),
        title: Text(e.vendorName, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('${e.category} • ${e.taxStatus}'),
        trailing: Text('\$${e.amount.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
