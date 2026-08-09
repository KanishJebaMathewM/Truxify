import 'package:flutter/material.dart';
import '../models/bridge_strike_prevention_model.dart';
import '../services/bridge_strike_prevention_service.dart';

class BridgeStrikePreventionScreen extends StatefulWidget {
  const BridgeStrikePreventionScreen({super.key});

  @override
  State<BridgeStrikePreventionScreen> createState() => _BridgeStrikePreventionScreenState();
}

class _BridgeStrikePreventionScreenState extends State<BridgeStrikePreventionScreen> {
  final BridgeStrikePreventionService _service = BridgeStrikePreventionService();
  RouteClearance? _clearance;

  @override
  void initState() {
    super.initState();
    _service.telemetryStream.listen((data) {
      if (mounted) setState(() => _clearance = data);
    });
    _service.simulateJourney();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  String _formatInchesToFtIn(double inches) {
    if (inches > 500) return 'Unlimited';
    int ft = (inches / 12).floor();
    int inc = (inches % 12).toInt();
    return "$ft'$inc\"";
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('3D Routing Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.black, // High contrast for navigation
      body: _clearance == null 
        ? const Center(child: CircularProgressIndicator()) 
        : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final c = _clearance!;
    final isDanger = c.truckHeightInches > c.hazardClearanceInches;
    final dangerColor = Colors.redAccent;
    final safeColor = Colors.greenAccent;

    return Column(
      children: [
        _buildMapPlaceholder(isDanger, c),
        Expanded(
          child: Container(
            width: double.infinity,
            padding: const EdgeInsets.all(24),
            decoration: BoxDecoration(
              color: Colors.grey[900],
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              border: Border(top: BorderSide(color: isDanger ? dangerColor : Colors.transparent, width: 4)),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildTruckProfile(c),
                const SizedBox(height: 24),
                _buildHazardWarningCard(c, isDanger, dangerColor, safeColor),
              ],
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildMapPlaceholder(bool isDanger, RouteClearance c) {
    return Container(
      height: 300,
      width: double.infinity,
      color: Colors.grey[850],
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.map, size: 150, color: Colors.white24),
          if (isDanger) ...[
            Container(color: Colors.redAccent.withOpacity(0.2)),
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.warning, color: Colors.redAccent, size: 80),
                const SizedBox(height: 8),
                Text('LOW CLEARANCE ${c.distanceToHazardMiles.toStringAsFixed(1)} MI', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
              ],
            )
          ] else if (c.isDeviationDetected && !c.isSafeRouteRecalculating) ...[
             const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.alt_route, color: Colors.blueAccent, size: 80),
                SizedBox(height: 8),
                Text('DETOUR ACTIVE', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
              ],
            )
          ] else ...[
            const Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                Icon(Icons.navigation, color: Colors.blueAccent, size: 80),
                SizedBox(height: 8),
                Text('SAFE ROUTE', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 2)),
              ],
            )
          ]
        ],
      ),
    );
  }

  Widget _buildTruckProfile(RouteClearance c) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('VEHICLE PROFILE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            const SizedBox(height: 4),
            Text('Class 8 Semi (Dry Van)', style: TextStyle(color: Colors.blueGrey[100], fontSize: 18)),
          ],
        ),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
          decoration: BoxDecoration(color: Colors.blueGrey[800], borderRadius: BorderRadius.circular(12)),
          child: Column(
            children: [
              const Text('CONFIG HEIGHT', style: TextStyle(color: Colors.grey, fontSize: 10)),
              Text(_formatInchesToFtIn(c.truckHeightInches), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildHazardWarningCard(RouteClearance c, bool isDanger, Color dangerColor, Color safeColor) {
    if (isDanger) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: dangerColor.withOpacity(0.1), borderRadius: BorderRadius.circular(16), border: Border.all(color: dangerColor)),
        child: Column(
          children: [
            const Icon(Icons.do_not_disturb_alt, color: Colors.redAccent, size: 48),
            const SizedBox(height: 16),
            const Text('BRIDGE STRIKE IMMINENT', style: TextStyle(color: Colors.redAccent, fontSize: 20, fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            Text('Approaching: ${c.nextHazardName}', style: const TextStyle(color: Colors.white)),
            Text('Clearance: ${_formatInchesToFtIn(c.hazardClearanceInches)}', style: const TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(height: 24),
            if (c.isSafeRouteRecalculating)
              const Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  SizedBox(width: 20, height: 20, child: CircularProgressIndicator(color: Colors.redAccent, strokeWidth: 2)),
                  SizedBox(width: 12),
                  Text('RECALCULATING SAFE ROUTE...', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold)),
                ],
              )
          ],
        ),
      );
    }

    if (c.isDeviationDetected && !c.isSafeRouteRecalculating) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(color: Colors.blue[900], borderRadius: BorderRadius.circular(16)),
        child: const Column(
          children: [
            Icon(Icons.turn_right, color: Colors.white, size: 48),
            SizedBox(height: 16),
            Text('DETOUR SECURED', style: TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
            Text('Routing around restricted bridge.', style: TextStyle(color: Colors.white70)),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(color: Colors.grey[850], borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: [
          Icon(Icons.check_circle_outline, color: safeColor, size: 48),
          const SizedBox(height: 16),
          Text('CLEARANCE SAFE', style: TextStyle(color: safeColor, fontSize: 20, fontWeight: FontWeight.bold)),
          Text('Next Structure: ${c.nextHazardName}', style: const TextStyle(color: Colors.grey)),
          Text('Clearance: ${_formatInchesToFtIn(c.hazardClearanceInches)}', style: const TextStyle(color: Colors.white)),
        ],
      ),
    );
  }
}
