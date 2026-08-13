import 'package:flutter/material.dart';
import '../models/engine_twin_model.dart';
import '../services/engine_twin_service.dart';

class EngineTwinScreen extends StatefulWidget {
  const EngineTwinScreen({super.key});

  @override
  State<EngineTwinScreen> createState() => _EngineTwinScreenState();
}

class _EngineTwinScreenState extends State<EngineTwinScreen> {
  final EngineTwinService _service = EngineTwinService();
  EngineTwinSession? _session;

  @override
  void initState() {
    super.initState();
    _service.twinStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateEngineFault();
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
        title: const Text('Digital Twin Engine'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[900], // Dark mode for 3D engine render
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
              _build3DEngineRender(s),
              const SizedBox(height: 24),
              const Text('CAN BUS COMPONENT TELEMETRY', style: TextStyle(color: Colors.white54, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.components.map((c) => _buildComponentCard(c)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(EngineTwinSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.activeFaultCode != null && s.components.any((c) => c.status == 'Critical Failure')) {
      headerColor = Colors.red[900]!;
      icon = Icons.error;
    } else if (s.activeFaultCode != null) {
      headerColor = Colors.orange[900]!;
      icon = Icons.warning;
    } else {
      headerColor = Colors.blue[900]!;
      icon = Icons.settings_input_component;
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
              const Text('J1939 TELEMETRY LINK', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.connectionStatus.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.activeFaultCode != null) ...[
            const SizedBox(height: 16),
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
              decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(8)),
              child: Text(s.activeFaultCode!, style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
            )
          ]
        ],
      ),
    );
  }

  Widget _build3DEngineRender(EngineTwinSession s) {
    // Determine the glow color based on the worst component status
    Color glowColor = Colors.blue;
    if (s.components.any((c) => c.status == 'Critical Failure')) {
      glowColor = Colors.red;
    } else if (s.components.any((c) => c.status == 'Warning')) {
      glowColor = Colors.orange;
    }

    return Card(
      elevation: 8,
      color: Colors.black,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16), side: BorderSide(color: glowColor.withOpacity(0.5), width: 2)),
      child: Container(
        height: 250,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: RadialGradient(
            colors: [glowColor.withOpacity(0.2), Colors.black],
            radius: 0.8,
          ),
        ),
        child: Center(
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.precision_manufacturing, size: 100, color: glowColor.withOpacity(0.8)),
              const SizedBox(height: 16),
              Text(
                s.activeFaultCode == null ? 'VIRTUAL ENGINE RENDER: NOMINAL' : 'ISOLATING FAULT LOCATION...',
                style: TextStyle(color: glowColor, fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildComponentCard(EngineComponent c) {
    Color cardColor;
    Color textColor;
    
    switch (c.status) {
      case 'Critical Failure':
        cardColor = Colors.red[900]!;
        textColor = Colors.white;
        break;
      case 'Warning':
        cardColor = Colors.orange[900]!;
        textColor = Colors.white;
        break;
      default:
        cardColor = Colors.grey[800]!;
        textColor = Colors.white70;
    }

    return Card(
      color: cardColor,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(c.id, style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 12)),
                const SizedBox(height: 4),
                Text(c.name, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
              ],
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Row(
                  children: [
                    const Icon(Icons.thermostat, color: Colors.white54, size: 16),
                    const SizedBox(width: 4),
                    Text('${c.tempFahrenheit.toInt()}°F', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ],
                ),
                const SizedBox(height: 4),
                Row(
                  children: [
                    const Icon(Icons.speed, color: Colors.white54, size: 16),
                    const SizedBox(width: 4),
                    Text('${c.pressurePsi.toInt()} PSI', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }
}
