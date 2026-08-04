import 'package:flutter/material.dart';
import '../models/platoon_match_model.dart';
import '../services/platooning_coordinator_service.dart';

class PlatooningDashboard extends StatefulWidget {
  const PlatooningDashboard({super.key});

  @override
  State<PlatooningDashboard> createState() => _PlatooningDashboardState();
}

class _PlatooningDashboardState extends State<PlatooningDashboard> {
  final PlatooningCoordinatorService _platooningService = PlatooningCoordinatorService();
  bool _isScanning = false;
  List<PlatoonMatch> _matches = [];
  PlatoonMatch? _activePlatoon;

  void _scanForPartners() async {
    setState(() {
      _isScanning = true;
    });

    final results = await _platooningService.findPlatoonPartners('I-80 West');

    if (mounted) {
      setState(() {
        _isScanning = false;
        _matches = results;
      });
    }
  }

  void _requestPlatoon(PlatoonMatch match) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        title: Text('Syncing Telemetry...'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            CircularProgressIndicator(),
            SizedBox(height: 16),
            Text('Requesting platoon formation with partner vehicle...'),
          ],
        ),
      )
    );
    
    final accepted = await _platooningService.sendPlatoonRequest(match.matchId);
    
    if (mounted && accepted) {
      Navigator.pop(context); // Close loading
      setState(() {
        _activePlatoon = match;
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Platoon Formed! Drafting behind ${match.partnerDriverName}.'),
          backgroundColor: Colors.green,
        )
      );
    }
  }

  void _breakPlatoon() {
    setState(() {
      _activePlatoon = null;
    });
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(content: Text('Platoon disconnected. Resuming manual spacing.'))
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Autonomous Platooning'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _activePlatoon != null ? _buildActivePlatoonView() : _buildMatchmakingView(),
    );
  }

  Widget _buildActivePlatoonView() {
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.all(24.0),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.link, size: 80, color: Colors.deepPurple[400]),
          const SizedBox(height: 16),
          const Text('ACTIVE PLATOON', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.deepPurple)),
          const SizedBox(height: 8),
          Text('Drafting with ${_activePlatoon!.partnerDriverName}', style: const TextStyle(fontSize: 18)),
          Text('Company: ${_activePlatoon!.partnerCompany}', style: const TextStyle(color: Colors.grey)),
          const SizedBox(height: 32),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildStatMetric('Distance', '65 ft', Icons.compare_arrows),
              _buildStatMetric('Fuel Savings', '${_activePlatoon!.estimatedFuelSavingsPercent}%', Icons.local_gas_station),
            ],
          ),
          const Spacer(),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton(
              onPressed: _breakPlatoon,
              style: ElevatedButton.styleFrom(backgroundColor: Colors.red[900], foregroundColor: Colors.white),
              child: const Text('DISCONNECT PLATOON'),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildStatMetric(String label, String value, IconData icon) {
    return Column(
      children: [
        Icon(icon, color: Colors.grey, size: 32),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.grey)),
      ],
    );
  }

  Widget _buildMatchmakingView() {
    return Column(
      children: [
        Container(
          padding: const EdgeInsets.all(24),
          color: Colors.white,
          width: double.infinity,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Highway Matchmaking', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('Find nearby trucks heading your way to form an aerodynamic slipstream and save fuel.', style: TextStyle(color: Colors.grey)),
              const SizedBox(height: 16),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: _isScanning ? null : _scanForPartners,
                  icon: const Icon(Icons.radar),
                  label: Text(_isScanning ? 'SCANNING HIGHWAY...' : 'FIND PLATOON PARTNERS'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple[900], foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 16)),
                ),
              )
            ],
          ),
        ),
        Expanded(
          child: _matches.isEmpty && !_isScanning
              ? const Center(child: Text('No partners found yet. Click scan.'))
              : _isScanning
                  ? Center(child: CircularProgressIndicator(color: Colors.deepPurple[900]))
                  : ListView.builder(
                      padding: const EdgeInsets.all(16),
                      itemCount: _matches.length,
                      itemBuilder: (context, index) {
                        return _buildPartnerCard(_matches[index]);
                      },
                    ),
        )
      ],
    );
  }

  Widget _buildPartnerCard(PlatoonMatch match) {
    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                CircleAvatar(backgroundColor: Colors.deepPurple[100], child: Icon(Icons.person, color: Colors.deepPurple[900])),
                const SizedBox(width: 12),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(match.partnerDriverName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      Text(match.partnerCompany, style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                  decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(20)),
                  child: Text(
                    '${match.estimatedFuelSavingsPercent}% Save',
                    style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold),
                  ),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Relative Position', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(match.distanceAheadMiles > 0 ? '${match.distanceAheadMiles} mi ahead' : '${match.distanceAheadMiles.abs()} mi behind', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Shared Route', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('${match.matchingMiles} miles', style: const TextStyle(fontWeight: FontWeight.bold)),
                  ],
                )
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _requestPlatoon(match),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurple[900], foregroundColor: Colors.white),
                child: const Text('REQUEST PLATOON'),
              ),
            )
          ],
        ),
      ),
    );
  }
}
