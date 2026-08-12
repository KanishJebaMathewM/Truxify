import 'package:flutter/material.dart';
import '../models/wildlife_ar_model.dart';
import '../services/wildlife_ar_service.dart';

class WildlifeArScreen extends StatefulWidget {
  const WildlifeArScreen({super.key});

  @override
  State<WildlifeArScreen> createState() => _WildlifeArScreenState();
}

class _WildlifeArScreenState extends State<WildlifeArScreen> {
  final WildlifeArService _service = WildlifeArService();
  WildlifeArSession? _session;

  @override
  void initState() {
    super.initState();
    _service.arStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateNightDrive();
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
        title: const Text('AR Night Vision'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.black, // Dark mode for FLIR display
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
              _buildFlirMock(s),
              const SizedBox(height: 24),
              const Text('ACTIVE THERMAL SIGNATURES', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.activeSignatures.isEmpty)
                const Card(
                  color: Colors.white10,
                  child: Padding(
                    padding: EdgeInsets.all(24),
                    child: Center(child: Text('No Threats Detected', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold))),
                  ),
                )
              else
                ...s.activeSignatures.map((sig) => _buildSignatureCard(sig)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WildlifeArSession s) {
    Color headerColor;
    IconData icon;
    
    if (s.isBrakingSuggested) {
      headerColor = Colors.red[900]!;
      icon = Icons.warning_amber_rounded;
    } else if (s.activeSignatures.isNotEmpty) {
      headerColor = Colors.orange[800]!;
      icon = Icons.visibility;
    } else {
      headerColor = Colors.green[900]!;
      icon = Icons.remove_red_eye;
    }

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
              const Text('AI WILDLIFE AVOIDANCE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
          if (s.isBrakingSuggested) ...[
            const SizedBox(height: 16),
            const LinearProgressIndicator(color: Colors.white, backgroundColor: Colors.white24),
          ]
        ],
      ),
    );
  }

  Widget _buildFlirMock(WildlifeArSession s) {
    bool hasMoose = s.activeSignatures.any((sig) => sig.objectClass == 'Moose');

    return Card(
      elevation: 8,
      color: Colors.black,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: s.isBrakingSuggested ? Colors.red : Colors.blueGrey[800]!, width: 2),
      ),
      child: Container(
        height: 250,
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(16),
          gradient: LinearGradient(
            colors: [Colors.grey[900]!, Colors.black],
            begin: Alignment.topCenter,
            end: Alignment.bottomCenter,
          )
        ),
        child: Stack(
          children: [
            // Center Road Reticle
            Center(
              child: CustomPaint(
                size: const Size(double.infinity, double.infinity),
                painter: RoadPerspectivePainter(),
              ),
            ),
            
            if (s.activeSignatures.isNotEmpty)
              Positioned(
                top: 60,
                right: 40,
                child: Container(
                  padding: const EdgeInsets.all(8),
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.orange, width: 2),
                    color: Colors.orange.withOpacity(0.2),
                  ),
                  child: const Text('DEER\n800 FT', style: TextStyle(color: Colors.orange, fontWeight: FontWeight.bold, fontSize: 10), textAlign: TextAlign.center),
                ),
              ),

            if (hasMoose)
              Positioned(
                top: 120,
                left: 100, // Entering the road
                child: Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    border: Border.all(color: Colors.red, width: 3),
                    color: Colors.red.withOpacity(0.3),
                  ),
                  child: const Text('MOOSE\nIMMINENT COLLISION\n400 FT', style: TextStyle(color: Colors.redAccent, fontWeight: FontWeight.bold, fontSize: 14), textAlign: TextAlign.center),
                ),
              ),

            Positioned(
              top: 16,
              left: 16,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('FLIR THERMAL', style: TextStyle(color: Colors.green, fontFamily: 'monospace', fontWeight: FontWeight.bold)),
                  Text('SPEED: ${s.vehicleSpeedMph.toInt()} MPH', style: const TextStyle(color: Colors.green, fontFamily: 'monospace')),
                ],
              ),
            ),
            
            if (s.isBrakingSuggested)
              Positioned(
                bottom: 16,
                left: 0,
                right: 0,
                child: Center(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 8),
                    decoration: BoxDecoration(color: Colors.red[900], borderRadius: BorderRadius.circular(20)),
                    child: const Text('APPLY BRAKES IMMEDIATELY', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2)),
                  ),
                ),
              )
          ],
        ),
      ),
    );
  }

  Widget _buildSignatureCard(ThermalSignature sig) {
    bool isCritical = sig.trajectoryAngle > 45.0 && sig.distanceFeet < 500.0;

    return Card(
      color: Colors.white10,
      elevation: isCritical ? 4 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isCritical ? Colors.red : Colors.orange, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(isCritical ? Icons.pets : Icons.visibility, color: isCritical ? Colors.red : Colors.orange),
                    const SizedBox(width: 12),
                    Text(sig.objectClass, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                  ],
                ),
                Text('AI Conf: ${(sig.confidenceScore * 100).toInt()}%', style: TextStyle(color: Colors.grey[400], fontWeight: FontWeight.bold, fontSize: 12)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Distance', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text('${sig.distanceFeet.toInt()} FT', style: TextStyle(color: isCritical ? Colors.red : Colors.white, fontWeight: FontWeight.bold, fontSize: 20)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    const Text('Trajectory', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    Text(sig.trajectoryAngle > 45.0 ? 'ENTERING ROAD' : 'PARALLEL', style: TextStyle(color: sig.trajectoryAngle > 45.0 ? Colors.redAccent : Colors.orange, fontWeight: FontWeight.bold, fontFamily: 'monospace')),
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

class RoadPerspectivePainter extends CustomPainter {
  @override
  void paint(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = Colors.green.withOpacity(0.3)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;

    final path = Path();
    path.moveTo(size.width * 0.45, size.height * 0.4); // Vanishing point left
    path.lineTo(size.width * 0.1, size.height); // Bottom left
    
    path.moveTo(size.width * 0.55, size.height * 0.4); // Vanishing point right
    path.lineTo(size.width * 0.9, size.height); // Bottom right

    // Center dash
    final dashPaint = Paint()
      ..color = Colors.green.withOpacity(0.5)
      ..strokeWidth = 2
      ..style = PaintingStyle.stroke;
      
    path.moveTo(size.width * 0.5, size.height * 0.4);
    path.lineTo(size.width * 0.5, size.height);

    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant CustomPainter oldDelegate) => false;
}
