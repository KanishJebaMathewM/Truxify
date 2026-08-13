import 'package:flutter/material.dart';
import '../models/safe_haven_model.dart';
import '../services/safe_haven_service.dart';

class SafeHavenScreen extends StatefulWidget {
  const SafeHavenScreen({super.key});

  @override
  State<SafeHavenScreen> createState() => _SafeHavenScreenState();
}

class _SafeHavenScreenState extends State<SafeHavenScreen> {
  final SafeHavenService _service = SafeHavenService();
  SafeHavenSession? _session;
  bool _hazmatSwitch = false;

  @override
  void initState() {
    super.initState();
    _service.havenStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeRouting();
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
        title: const Text('Compliance Routing'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _session?.isRecalculating == true ? null : () {
          setState(() => _hazmatSwitch = !_hazmatSwitch);
          _service.toggleHazmatMode(_hazmatSwitch);
        },
        backgroundColor: _hazmatSwitch ? Colors.red : Colors.indigo,
        icon: Icon(_hazmatSwitch ? Icons.local_fire_department : Icons.route),
        label: Text(_hazmatSwitch ? 'Disable Hazmat Mode' : 'Enable Hazmat Mode'),
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
              if (s.hazmatModeActive && !s.isRecalculating) ...[
                _buildDetourCard(s.addedDetourMiles),
                const SizedBox(height: 24),
                const Text('AVOIDED RESTRICTIONS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.avoidedHazards.map((h) => _buildHazardCard(h)),
                const SizedBox(height: 24),
                const Text('CERTIFIED SAFE HAVENS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 12),
                ...s.certifiedHavens.map((sh) => _buildHavenCard(sh)),
              ] else if (!s.isRecalculating) ...[
                const Center(child: Padding(
                  padding: EdgeInsets.all(32.0),
                  child: Text('Standard routing active. Enable Hazmat mode for compliance recalculation.', textAlign: TextAlign.center, style: TextStyle(color: Colors.grey)),
                ))
              ],
              const SizedBox(height: 80), // Padding for FAB
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(SafeHavenSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: s.isRecalculating 
        ? Colors.indigo[600] 
        : (s.hazmatModeActive ? Colors.red[800] : Colors.blueGrey[800]),
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              s.isRecalculating 
                ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(color: Colors.white, strokeWidth: 3))
                : Icon(s.hazmatModeActive ? Icons.warning : Icons.map, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('SPATIAL COMPLIANCE LAYER', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildDetourCard(double detour) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.red, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            const Row(
              children: [
                Icon(Icons.alt_route, color: Colors.red),
                SizedBox(width: 12),
                Text('Hazmat Reroute Distance', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Expanded(
                  child: Text('Routing around federal tunnels has increased your total transit distance.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ),
                const SizedBox(width: 16),
                Text('+${detour.toStringAsFixed(1)} mi', style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.red[900])),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildHazardCard(RouteRestriction h) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.do_not_disturb_alt, color: Colors.red, size: 16),
                    const SizedBox(width: 8),
                    Text(h.featureName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                const SizedBox(height: 4),
                Text(h.location, style: const TextStyle(color: Colors.grey, fontSize: 12)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(h.restrictionType.toUpperCase(), style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo, fontSize: 10)),
                const SizedBox(height: 4),
                Text(h.penalty, style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildHavenCard(SafeHaven sh) {
    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        side: const BorderSide(color: Colors.green, width: 2),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Text(sh.havenName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                ),
                if (sh.hasSecurity) 
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(4), border: Border.all(color: Colors.blue)),
                    child: const Row(
                      children: [
                        Icon(Icons.security, size: 12, color: Colors.blue),
                        SizedBox(width: 4),
                        Text('ARMED SECURITY', style: TextStyle(fontSize: 8, fontWeight: FontWeight.bold, color: Colors.blue)),
                      ],
                    ),
                  )
              ],
            ),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(sh.location, style: const TextStyle(color: Colors.grey)),
                Text('+${sh.distanceDetourMiles} mi detour', style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
