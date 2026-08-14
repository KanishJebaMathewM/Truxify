import 'package:flutter/material.dart';
import 'dart:math';
import '../models/toll_estimator_model.dart';
import '../services/toll_estimator_service.dart';

class TollEstimatorScreen extends StatefulWidget {
  const TollEstimatorScreen({super.key});

  @override
  State<TollEstimatorScreen> createState() => _TollEstimatorScreenState();
}

class _TollEstimatorScreenState extends State<TollEstimatorScreen> {
  final TollEstimatorService _service = TollEstimatorService();
  TollEstimationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.estimatorStream.listen((data) {
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
        title: const Text('International Toll Estimator'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isEstimating == true ? null : () => _showRoutePicker(context),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.calculate),
        label: const Text('Estimate Cross-Border Tolls'),
      ),
    );
  }

  void _showRoutePicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Select International Route', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ),
              ListTile(
                leading: const Icon(Icons.flag, color: Colors.red),
                title: const Text('US to Canada (USMCA)'),
                subtitle: const Text('Detroit, MI ➔ Toronto, ON'),
                onTap: () {
                  Navigator.pop(context);
                  _service.calculateCrossBorderRoute('Detroit, MI', 'Toronto, ON');
                },
              ),
              ListTile(
                leading: const Icon(Icons.flag, color: Colors.green),
                title: const Text('US to Mexico (USMCA)'),
                subtitle: const Text('Laredo, TX ➔ Monterrey, NL'),
                onTap: () {
                  Navigator.pop(context);
                  _service.calculateCrossBorderRoute('Laredo, TX', 'Monterrey, NL');
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
              if (s.routeTolls.isNotEmpty) ...[
                _buildTotalCostCard(s),
                const SizedBox(height: 24),
                const Text('MULTI-CURRENCY TOLL LEDGER', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.routeTolls.map((t) => _buildTollCard(t, s)),
              ] else ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Tap Estimate to calculate international route costs.', style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(TollEstimationSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isEstimating ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isEstimating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.currency_exchange, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('FOREX ROUTING ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTotalCostCard(TollEstimationSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.indigo, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.route, color: Colors.indigo),
                const SizedBox(width: 12),
                Expanded(child: Text('${s.origin} ➔ ${s.destination}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18))),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Est. Total Route Cost', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 16)),
                Text('\$${s.totalCostUSD.toStringAsFixed(2)} USD', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.indigo)),
              ],
            ),
            const SizedBox(height: 16),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(8)),
              child: const Text(
                'Converted to your home currency (USD) using live FOREX rates.',
                style: TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold, fontSize: 12),
                textAlign: TextAlign.center,
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTollCard(TollPlaza toll, TollEstimationSession s) {
    Color cardColor = toll.country == 'USA' ? Colors.blueGrey : (toll.country == 'Canada' ? Colors.red : Colors.green);
    
    double convertedUsd = toll.localCurrencyAmount;
    if (toll.localCurrencyCode == 'CAD') convertedUsd *= s.exchangeRateCADtoUSD;
    if (toll.localCurrencyCode == 'MXN') convertedUsd *= s.exchangeRateMXNtoUSD;

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: ListTile(
        leading: CircleAvatar(
          backgroundColor: cardColor.withOpacity(0.1),
          child: Text(toll.country.substring(0, min(3, toll.country.length)).toUpperCase(), style: TextStyle(color: cardColor, fontWeight: FontWeight.bold, fontSize: 12)),
        ),
        title: Text(toll.name, style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: toll.localCurrencyCode == 'USD' 
          ? const Text('Domestic Toll') 
          : Text('Foreign Toll: ${toll.localCurrencyAmount.toStringAsFixed(2)} ${toll.localCurrencyCode}'),
        trailing: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text('\$${convertedUsd.toStringAsFixed(2)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.indigo)),
            const Text('USD', style: TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }

  int min(int a, int b) => a < b ? a : b;
}
