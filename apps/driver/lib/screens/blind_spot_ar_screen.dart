import 'package:flutter/material.dart';
import '../models/blind_spot_ar_model.dart';
import '../services/blind_spot_ar_service.dart';

class BlindSpotArScreen extends StatefulWidget {
  const BlindSpotArScreen({super.key});

  @override
  State<BlindSpotArScreen> createState() => _BlindSpotArScreenState();
}

class _BlindSpotArScreenState extends State<BlindSpotArScreen> {
  final BlindSpotArService _service = BlindSpotArService();
  BlindSpotSession? _session;

  @override
  void initState() {
    super.initState();
    _service.arStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateHighwayDriving();
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
        title: const Text('AR Blind Spot Engine'),
        backgroundColor: Colors.black, // Dark mode for AR cameras
      ),
      backgroundColor: Colors.grey[900],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    bool isCritical = s.turnSignalActive && s.activeWarningZone != null;

    return Column(
      children: [
        _buildStatusHeader(s, isCritical),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Row(
              children: [
                Expanded(flex: 3, child: _buildAROverheadView(s, isCritical)),
                const SizedBox(width: 16),
                Expanded(flex: 2, child: _buildThreatList(s, isCritical)),
              ],
            ),
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(BlindSpotSession s, bool isCritical) {
    Color headerColor = isCritical ? Colors.red[900]! : (s.activeWarningZone != null ? Colors.orange[800]! : Colors.blueGrey[900]!);
    IconData icon = isCritical ? Icons.warning : (s.activeWarningZone != null ? Icons.visibility : Icons.remove_red_eye);

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
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
              const Text('360° SPATIAL STITCHING', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 2)),
            ],
          ),
          const SizedBox(height: 12),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildAROverheadView(BlindSpotSession s, bool isCritical) {
    bool hasRightHazard = s.detectedVehicles.any((v) => v.isHazard && v.locationZone.contains('Right'));
    bool hasLeftHazard = s.detectedVehicles.any((v) => v.isHazard && v.locationZone.contains('Left'));

    return Container(
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.grey[800]!),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          // Highway lines
          Column(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(5, (_) => Container(width: 4, height: 40, color: Colors.white30)),
          ),
          
          // Truck
          Container(
            width: 60,
            height: 250,
            decoration: BoxDecoration(
              color: Colors.blueGrey[200],
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Column(
              children: [
                SizedBox(height: 10),
                Icon(Icons.crop_square, size: 40, color: Colors.blueGrey), // Cab
                Expanded(child: Center(child: Text('53\'', style: TextStyle(color: Colors.black54, fontWeight: FontWeight.bold)))), // Trailer
              ],
            ),
          ),

          // Right Blind Spot Zone (Red if hazard, yellow if warning)
          if (hasRightHazard)
            Positioned(
              right: 20,
              top: 100,
              child: AnimatedContainer(
                duration: const Duration(milliseconds: 500),
                width: 50,
                height: 150,
                decoration: BoxDecoration(
                  color: (isCritical ? Colors.red : Colors.orange).withOpacity(0.4),
                  borderRadius: BorderRadius.circular(8),
                  border: Border.all(color: isCritical ? Colors.red : Colors.orange, width: 2),
                ),
                child: const Center(child: Icon(Icons.directions_car, color: Colors.white, size: 32)),
              ),
            ),
            
          // Turn Signal Indicator
          if (s.turnSignalActive)
            Positioned(
              right: 60,
              top: 80,
              child: Icon(Icons.arrow_forward, color: Colors.yellow, size: 48), // Blinking in real app
            ),
        ],
      ),
    );
  }

  Widget _buildThreatList(BlindSpotSession s, bool isCritical) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const Text('RADAR TRACKING', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
        const SizedBox(height: 12),
        Expanded(
          child: ListView(
            children: s.detectedVehicles.map((v) {
              Color vColor = v.isHazard ? (isCritical ? Colors.red : Colors.orange) : Colors.green;
              return Card(
                color: Colors.grey[800],
                margin: const EdgeInsets.only(bottom: 8),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: vColor),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(12),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(v.type, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                          Icon(v.isHazard ? Icons.warning : Icons.check_circle, color: vColor, size: 16),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text(v.locationZone, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                      const SizedBox(height: 4),
                      Text('${v.distanceFeet.toInt()} ft gap', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16)),
                    ],
                  ),
                ),
              );
            }).toList(),
          ),
        ),
      ],
    );
  }
}
