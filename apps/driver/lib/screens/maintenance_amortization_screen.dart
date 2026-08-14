import 'package:flutter/material.dart';
import '../models/maintenance_amortization_model.dart';
import '../services/maintenance_amortization_service.dart';

class MaintenanceAmortizationScreen extends StatefulWidget {
  const MaintenanceAmortizationScreen({super.key});

  @override
  State<MaintenanceAmortizationScreen> createState() => _MaintenanceAmortizationScreenState();
}

class _MaintenanceAmortizationScreenState extends State<MaintenanceAmortizationScreen> {
  final MaintenanceAmortizationService _service = MaintenanceAmortizationService();
  MaintenanceAmortizationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.amortizationStream.listen((data) {
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
        title: const Text('Maintenance Amortization Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isCalculating == true ? null : () => _service.runAmortizationEngine(),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.calculate),
        label: const Text('Calculate Depreciation matrix'),
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
              if (s.vehicleComponents.isNotEmpty) ...[
                _buildTotalCpmCard(s.totalMaintenanceCPM),
                const SizedBox(height: 24),
                const Text('LOAD BOARD PROFITABILITY ADJUSTMENT', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.simulatedLoads.map((load) => _buildAmortizedLoadCard(load)),
                const SizedBox(height: 24),
                const Text('VEHICLE COMPONENT LIFECYCLES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.vehicleComponents.map((comp) => _buildComponentCard(comp)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Calculate to run financial depreciation modeling.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(MaintenanceAmortizationSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isCalculating ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isCalculating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.money_off, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('FINANCIAL ACCOUNTING ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTotalCpmCard(double totalCpm) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.orange, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Row(
              children: [
                Icon(Icons.build, color: Colors.orange),
                SizedBox(width: 12),
                Text('Real-Time Maintenance CPM', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text('You must save this amount for every single mile you drive to avoid bankruptcy when your truck breaks down.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ),
                const SizedBox(width: 16),
                Text('\$${totalCpm.toStringAsFixed(3)} / mi', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.orange[900])),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildAmortizedLoadCard(AmortizedLoad load) {
    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('${load.origin} ➔ ${load.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                Text('${load.miles} mi', style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Gross Revenue (Broker Offer)', style: TextStyle(color: Colors.blueGrey)),
                Text('\$${load.grossRevenue.toStringAsFixed(2)}', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Maintenance Reserve Deduction', style: TextStyle(color: Colors.red)),
                Text('- \$${load.maintenanceReserveCost.toStringAsFixed(2)}', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(8)),
              child: Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text('TRUE AMORTIZED PROFIT', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold)),
                  Text('\$${load.amortizedNetProfit.toStringAsFixed(2)}', style: TextStyle(color: Colors.green[900], fontSize: 20, fontWeight: FontWeight.bold)),
                ],
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildComponentCard(MaintenanceItem comp) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const Icon(Icons.settings, color: Colors.grey),
        title: Text(comp.componentName, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text('Cost: \$${comp.replacementCost.toStringAsFixed(0)} | Lifespan: ${comp.lifecycleMiles} mi'),
        trailing: Text('\$${comp.costPerMile.toStringAsFixed(3)} /mi', style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
      ),
    );
  }
}
