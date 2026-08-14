import 'package:flutter/material.dart';
import '../models/bridge_validation_model.dart';
import '../services/bridge_validation_service.dart';

class BridgeValidationScreen extends StatefulWidget {
  const BridgeValidationScreen({super.key});

  @override
  State<BridgeValidationScreen> createState() => _BridgeValidationScreenState();
}

class _BridgeValidationScreenState extends State<BridgeValidationScreen> {
  final BridgeValidationService _service = BridgeValidationService();
  BridgeValidationSession? _session;

  @override
  void initState() {
    super.initState();
    _service.validationStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateBridgeValidation();
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
        title: const Text('Bridge Weight Validation'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
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
              _buildTruckWeightCard(s),
              const SizedBox(height: 24),
              const Text('INFRASTRUCTURE SCAN', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.nextBridge != null) _buildBridgeCard(s),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BridgeValidationSession s) {
    Color headerColor = Colors.blueGrey[800]!;
    IconData icon = Icons.radar;
    
    if (!s.isSafeToCross) {
      headerColor = Colors.red[900]!;
      icon = Icons.block;
    } else if (s.nextBridge != null) {
      headerColor = Colors.green[700]!;
      icon = Icons.check_circle_outline;
    }

    return AnimatedContainer(
      duration: const Duration(milliseconds: 500),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: headerColor,
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icon, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('STRUCTURAL AI LAYER', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildTruckWeightCard(BridgeValidationSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            const Text('LIVE TRUCK WEIGHT', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.local_shipping, color: Colors.blueGrey[900], size: 48),
                const SizedBox(width: 16),
                Text('${s.truckGrossWeightLbs.toString()} lbs', style: TextStyle(color: Colors.blueGrey[900], fontSize: 36, fontWeight: FontWeight.bold)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildBridgeCard(BridgeValidationSession s) {
    final b = s.nextBridge!;
    bool isHazard = !s.isSafeToCross;

    return Card(
      elevation: isHazard ? 8 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isHazard ? Colors.red : Colors.transparent, width: 2),
      ),
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: isHazard ? Colors.red[50] : Colors.grey[100],
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(16), topRight: Radius.circular(16)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(b.bridgeName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      const SizedBox(height: 4),
                      Text(b.highwayRoute, style: TextStyle(color: Colors.grey[700])),
                    ],
                  ),
                ),
                Icon(Icons.architecture, color: isHazard ? Colors.red : Colors.blueGrey),
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Structural Limit:', style: TextStyle(fontSize: 16)),
                    Text('${b.structuralLimitLbs} lbs', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                const SizedBox(height: 12),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Engineering Status:', style: TextStyle(fontSize: 16)),
                    Expanded(
                      child: Text(b.engineeringStatus, textAlign: TextAlign.right, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: isHazard ? Colors.orange[900] : Colors.green[700])),
                    ),
                  ],
                ),
                if (isHazard && s.weightDeltaLbs != null) ...[
                  const Divider(height: 32),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(color: Colors.red[900], borderRadius: BorderRadius.circular(8)),
                    child: Column(
                      children: [
                        const Text('CRITICAL OVERWEIGHT', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
                        const SizedBox(height: 8),
                        Text('Truck exceeds structural limit by ${s.weightDeltaLbs} lbs.', textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16)),
                        const SizedBox(height: 8),
                        const Text('App has automatically blocked this route.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white70, fontSize: 14, fontStyle: FontStyle.italic)),
                      ],
                    ),
                  )
                ]
              ],
            ),
          )
        ],
      ),
    );
  }
}
