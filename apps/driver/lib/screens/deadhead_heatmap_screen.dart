import 'package:flutter/material.dart';
import '../models/deadhead_heatmap_model.dart';
import '../services/deadhead_heatmap_service.dart';

class DeadheadHeatmapScreen extends StatefulWidget {
  const DeadheadHeatmapScreen({super.key});

  @override
  State<DeadheadHeatmapScreen> createState() => _DeadheadHeatmapScreenState();
}

class _DeadheadHeatmapScreenState extends State<DeadheadHeatmapScreen> {
  final DeadheadHeatmapService _service = DeadheadHeatmapService();
  DeadheadSession? _session;

  @override
  void initState() {
    super.initState();
    _service.heatmapStream.listen((data) {
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
        title: const Text('Deadhead Heatmap AI'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _showDestinationPicker(context),
        backgroundColor: Colors.indigo,
        icon: const Icon(Icons.search),
        label: const Text('Analyze Destination'),
      ),
    );
  }

  void _showDestinationPicker(BuildContext context) {
    showModalBottomSheet(
      context: context,
      builder: (context) {
        return SafeArea(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Padding(
                padding: EdgeInsets.all(16.0),
                child: Text('Simulate Destination Load', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ),
              ListTile(
                leading: const Icon(Icons.location_city, color: Colors.green),
                title: const Text('High Density Market (Chicago, IL)'),
                onTap: () {
                  Navigator.pop(context);
                  _service.analyzeDestination('IL');
                },
              ),
              ListTile(
                leading: const Icon(Icons.landscape, color: Colors.red),
                title: const Text('Freight Desert (Billings, MT)'),
                onTap: () {
                  Navigator.pop(context);
                  _service.analyzeDestination('MT');
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
              _buildMockMapUI(s),
              const SizedBox(height: 24),
              const Text('DESTINATION RISK ANALYSIS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.selectedRegion == null)
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Select a destination to analyze deadhead risk.', style: TextStyle(color: Colors.grey)),
                ))
              else
                _buildRegionCard(s.selectedRegion!),
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(DeadheadSession s) {
    bool isAnalyzing = s.status.contains('Querying') || s.status.contains('Rendering');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isAnalyzing ? Colors.indigo[600] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              isAnalyzing 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : const Icon(Icons.map, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('SPATIAL FREIGHT DENSITY', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildMockMapUI(DeadheadSession s) {
    return Container(
      height: 250,
      decoration: BoxDecoration(
        color: Colors.blueGrey[100],
        border: Border.all(color: Colors.blueGrey, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.public, size: 150, color: Colors.black12),
          // Render Mock Heatmap Nodes
          ...s.heatmapData.map((region) {
            bool isSelected = s.selectedRegion?.stateCode == region.stateCode;
            Color heatColor = _getHeatColor(region.emptyMileProbability);
            
            // Just spreading them out randomly for the mock UI
            double left = (region.stateCode == 'IL' ? 200 : region.stateCode == 'TX' ? 150 : region.stateCode == 'MT' ? 50 : 100);
            double top = (region.stateCode == 'IL' ? 50 : region.stateCode == 'TX' ? 150 : region.stateCode == 'MT' ? 40 : 80);

            return Positioned(
              left: left,
              top: top,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 500),
                width: isSelected ? 60 : 40,
                height: isSelected ? 60 : 40,
                decoration: BoxDecoration(
                  shape: BoxShape.circle,
                  color: heatColor.withOpacity(0.6),
                  border: isSelected ? Border.all(color: Colors.white, width: 3) : null,
                  boxShadow: isSelected ? [BoxShadow(color: heatColor, blurRadius: 10, spreadRadius: 5)] : null,
                ),
                child: Center(
                  child: Text(region.stateCode, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 12)),
                ),
              ),
            );
          }),
        ],
      ),
    );
  }

  Color _getHeatColor(double probability) {
    if (probability > 0.7) return Colors.red;
    if (probability > 0.4) return Colors.orange;
    return Colors.green;
  }

  Widget _buildRegionCard(MarketRegion region) {
    Color riskColor = _getHeatColor(region.emptyMileProbability);
    IconData riskIcon = region.emptyMileProbability > 0.7 ? Icons.warning : Icons.check_circle;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: riskColor, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(riskIcon, color: riskColor, size: 28),
                const SizedBox(width: 12),
                Text(region.regionName, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildMetric('Empty Probability', '${(region.emptyMileProbability * 100).toStringAsFixed(0)}%', riskColor),
                _buildMetric('Load/Truck Ratio', region.loadToTruckRatio.toString(), Colors.blueGrey),
                _buildMetric('Est. Reload Rate', '\$${region.averageReloadRate.toStringAsFixed(2)}/mi', Colors.blueGrey),
              ],
            ),
            const SizedBox(height: 24),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(color: riskColor.withOpacity(0.1), borderRadius: BorderRadius.circular(8)),
              child: Text(
                region.emptyMileProbability > 0.7 
                  ? 'CRITICAL RISK: Highly likely to deadhead out of this market. Negotiate a higher inbound rate.'
                  : 'SAFE: Plentiful reloads available in this market.',
                style: TextStyle(color: riskColor, fontWeight: FontWeight.bold),
                textAlign: TextAlign.center,
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildMetric(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: color)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
