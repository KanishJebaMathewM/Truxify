import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/cash_flow_simulator_model.dart';
import '../services/cash_flow_simulator_service.dart';

class CashFlowSimulatorScreen extends StatefulWidget {
  const CashFlowSimulatorScreen({super.key});

  @override
  State<CashFlowSimulatorScreen> createState() => _CashFlowSimulatorScreenState();
}

class _CashFlowSimulatorScreenState extends State<CashFlowSimulatorScreen> {
  final CashFlowSimulatorService _service = CashFlowSimulatorService();
  CashFlowSession? _session;

  @override
  void initState() {
    super.initState();
    _service.cashFlowStream.listen((data) {
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
        title: const Text('FinTech Cash Flow Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _service.runSimulation(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.show_chart),
        label: const Text('Run Financial Simulation'),
      ),
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
              _buildBalanceSummaryCard(s),
              const SizedBox(height: 24),
              const Text('PROJECTED FINANCIAL EVENTS (7-DAY TIMELINE)', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.projectedEvents.isEmpty)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Run Simulation to generate financial forecast.', style: TextStyle(color: Colors.grey)),
                ))
              else
                ...s.projectedEvents.map((e) => _buildEventCard(e)),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(CashFlowSession s) {
    bool isSimulating = s.status.contains('Aggregating') || s.status.contains('Calculating');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isSimulating ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              isSimulating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.account_balance, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('PREDICTIVE LEDGER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildBalanceSummaryCard(CashFlowSession s) {
    Color riskColor = s.hasOverdraftRisk ? Colors.red : Colors.green;
    
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: s.projectedEvents.isNotEmpty ? riskColor : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Current Operating Capital', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                Text('\$${s.startingBalance.toStringAsFixed(2)}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              ],
            ),
            if (s.projectedEvents.isNotEmpty) ...[
              const Divider(height: 32),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  const Text('Lowest Projected Balance (7 Days)', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                  Text(
                    '\$${s.minimumProjectedBalance.toStringAsFixed(2)}', 
                    style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: riskColor)
                  ),
                ],
              ),
              const SizedBox(height: 16),
              if (s.hasOverdraftRisk)
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.red[50], borderRadius: BorderRadius.circular(8)),
                  child: Row(
                    children: [
                      const Icon(Icons.warning, color: Colors.red),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Text(
                          'CRITICAL CASH FLOW WARNING: Accounts payable exceed available capital before outstanding invoices clear. Consider factoring invoices to accelerate cash flow.',
                          style: TextStyle(color: Colors.red[900], fontWeight: FontWeight.bold, fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                )
              else
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
                  child: Text(
                    'CASH FLOW STABLE: You have sufficient capital to cover upcoming liabilities.',
                    style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, fontSize: 12),
                    textAlign: TextAlign.center,
                  ),
                )
            ]
          ],
        ),
      ),
    );
  }

  Widget _buildEventCard(FinancialEvent event) {
    bool isExpense = event.isExpense;
    Color iconColor = isExpense ? Colors.red : Colors.green;
    IconData icon = isExpense ? Icons.arrow_downward : Icons.arrow_upward;
    String prefix = isExpense ? '-' : '+';

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: iconColor.withOpacity(0.1),
          child: Icon(icon, color: iconColor),
        ),
        title: Text(event.description, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 4),
            Text('Est. Clear Date: ${DateFormat('MMM dd, yyyy').format(event.estimatedDate)}'),
            if (event.associatedBroker != null) ...[
              const SizedBox(height: 4),
              Text(event.associatedBroker!, style: TextStyle(color: Colors.orange[800], fontSize: 12, fontWeight: FontWeight.bold)),
            ]
          ],
        ),
        trailing: Text(
          '$prefix\$${event.amount.toStringAsFixed(2)}', 
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: iconColor)
        ),
      ),
    );
  }
}
