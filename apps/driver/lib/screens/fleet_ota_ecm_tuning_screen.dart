import 'package:flutter/material.dart';
import '../models/fleet_ota_ecm_tuning_model.dart';
import '../services/fleet_ota_ecm_tuning_service.dart';

class FleetOtaEcmTuningScreen extends StatefulWidget {
  const FleetOtaEcmTuningScreen({super.key});

  @override
  State<FleetOtaEcmTuningScreen> createState() => _FleetOtaEcmTuningScreenState();
}

class _FleetOtaEcmTuningScreenState extends State<FleetOtaEcmTuningScreen> {
  final FleetOtaEcmTuningService _service = FleetOtaEcmTuningService();
  EcmTuneProfile? _currentProfile;
  bool _isFlashing = false;

  @override
  void initState() {
    super.initState();
    _service.tuneStream.listen((profile) {
      if (mounted) setState(() => _currentProfile = profile);
    });
    _service.simulateRoute();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  void _triggerOtaUpdate() async {
    setState(() => _isFlashing = true);
    
    await _service.flashEcmUpdate();
    
    if (mounted) {
      setState(() {
        _isFlashing = false;
        // Mock updating the state to applied
        _currentProfile = EcmTuneProfile(
          profileId: _currentProfile!.profileId,
          profileName: _currentProfile!.profileName,
          peakTorqueLbFt: _currentProfile!.peakTorqueLbFt,
          shiftPointRpm: _currentProfile!.shiftPointRpm,
          isApplied: true,
          upcomingTopology: _currentProfile!.upcomingTopology,
        );
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Dynamic ECM Tuning'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[900],
      body: _currentProfile == null
          ? const Center(child: CircularProgressIndicator(color: Colors.deepPurpleAccent))
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final p = _currentProfile!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          _buildTopologyCard(p.upcomingTopology),
          const SizedBox(height: 24),
          const Text('ENGINE CONTROL MODULE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
          const SizedBox(height: 8),
          _buildActiveTuneCard(p),
          const SizedBox(height: 24),
          if (!p.isApplied) _buildOtaUpdateBanner(p),
        ],
      ),
    );
  }

  Widget _buildTopologyCard(RouteTopology t) {
    bool isMountain = t.terrainType.contains('Mountain');
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: isMountain ? [Colors.orange[900]!, Colors.red[900]!] : [Colors.blue[900]!, Colors.teal[900]!],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text('UPCOMING TERRAIN PREDICTION', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(t.terrainType, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
              Icon(isMountain ? Icons.terrain : Icons.straight, color: Colors.white, size: 32),
            ],
          ),
          const Divider(color: Colors.white24, height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              _buildSmallMetric('Distance', '${t.distanceMiles.toInt()} mi'),
              _buildSmallMetric('Avg Grade', '${t.averageGradePct}%'),
              _buildSmallMetric('Max Grade', '${t.maxGradePct}%'),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildSmallMetric(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: Colors.white54, fontSize: 12)),
        Text(value, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
      ],
    );
  }

  Widget _buildActiveTuneCard(EcmTuneProfile p) {
    return Card(
      color: Colors.black,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: p.isApplied ? Colors.deepPurpleAccent : Colors.grey[800]!, width: 2)
      ),
      child: Padding(
        padding: const EdgeInsets.all(24.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(p.isApplied ? 'ACTIVE TUNE' : 'RECOMMENDED TUNE', style: TextStyle(color: p.isApplied ? Colors.deepPurpleAccent : Colors.orangeAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                      const SizedBox(height: 4),
                      Text(p.profileName, style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.bold)),
                    ],
                  ),
                ),
                if (p.isApplied) const Icon(Icons.check_circle, color: Colors.deepPurpleAccent, size: 32)
              ],
            ),
            const SizedBox(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildGauge('PEAK TORQUE', '${p.peakTorqueLbFt.toInt()}', 'lb-ft'),
                _buildGauge('SHIFT POINT', '${p.shiftPointRpm}', 'RPM'),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildGauge(String label, String value, String unit) {
    return Column(
      children: [
        Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              height: 100,
              width: 100,
              child: CircularProgressIndicator(value: 0.8, color: Colors.deepPurpleAccent, backgroundColor: Colors.grey[800], strokeWidth: 8),
            ),
            Column(
              children: [
                Text(value, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
                Text(unit, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            )
          ],
        ),
        const SizedBox(height: 16),
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 12)),
      ],
    );
  }

  Widget _buildOtaUpdateBanner(EcmTuneProfile p) {
    if (_isFlashing) {
      return Container(
        width: double.infinity,
        padding: const EdgeInsets.all(24),
        decoration: BoxDecoration(color: Colors.orange[900], borderRadius: BorderRadius.circular(16)),
        child: const Column(
          children: [
            CircularProgressIndicator(color: Colors.white),
            SizedBox(height: 16),
            Text('FLASHING ECM...', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18, letterSpacing: 2)),
            Text('Do not turn off the engine.', style: TextStyle(color: Colors.white70)),
          ],
        ),
      );
    }

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(color: Colors.grey[800], borderRadius: BorderRadius.circular(16), border: Border.all(color: Colors.orangeAccent)),
      child: Column(
        children: [
          const Icon(Icons.system_update_alt, color: Colors.orangeAccent, size: 48),
          const SizedBox(height: 16),
          const Text('OTA TUNE UPDATE AVAILABLE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
          const SizedBox(height: 8),
          const Text('Optimize engine parameters for upcoming steep grades to prevent power loss.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton(
              onPressed: _triggerOtaUpdate,
              style: ElevatedButton.styleFrom(backgroundColor: Colors.orangeAccent, foregroundColor: Colors.black),
              child: const Text('FLASH ECM NOW', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ),
          )
        ],
      ),
    );
  }
}
