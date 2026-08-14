import 'package:flutter/material.dart';
import '../models/ar_loading_model.dart';
import '../services/ar_loading_optimizer_service.dart';

class ArLoadingOptimizerScreen extends StatefulWidget {
  const ArLoadingOptimizerScreen({super.key});

  @override
  State<ArLoadingOptimizerScreen> createState() => _ArLoadingOptimizerScreenState();
}

class _ArLoadingOptimizerScreenState extends State<ArLoadingOptimizerScreen> {
  final ArLoadingOptimizerService _service = ArLoadingOptimizerService();
  TrailerLoadState? _state;
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _startAR();
  }

  void _startAR() {
    _service.streamLoadingProcess().listen((state) {
      if (mounted) {
        setState(() {
          _state = state;
          _isLoading = false;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('AR Loading Optimizer'),
        backgroundColor: Colors.teal[800],
      ),
      backgroundColor: Colors.black, // Simulating camera view background
      body: _isLoading
          ? const Center(child: CircularProgressIndicator(color: Colors.teal))
          : Stack(
              children: [
                _buildMockCameraFeed(),
                _buildAROverlay(),
                _buildBottomHUD(),
              ],
            ),
    );
  }

  Widget _buildMockCameraFeed() {
    // Simulates a darkened camera feed of a trailer interior
    return Container(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topCenter,
          end: Alignment.bottomCenter,
          colors: [Colors.grey[900]!, Colors.grey[800]!]
        )
      ),
      child: const Center(
         child: Icon(Icons.camera_alt, color: Colors.white24, size: 100),
      ),
    );
  }

  Widget _buildAROverlay() {
    final active = _state?.activeInstruction;
    if (active == null) return const SizedBox.shrink();

    return Center(
      child: Container(
        width: 250,
        height: 200,
        decoration: BoxDecoration(
          border: Border.all(color: Colors.tealAccent, width: 4),
          color: Colors.tealAccent.withOpacity(0.2),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.arrow_downward, color: Colors.tealAccent, size: 60),
            const SizedBox(height: 16),
            Text(
              'TARGET: ${active.targetZone.toUpperCase()}',
              style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18, shadows: [Shadow(blurRadius: 10, color: Colors.black)]),
            ),
            const SizedBox(height: 8),
            Text(
              '${active.weightLbs.toInt()} lbs',
              style: const TextStyle(color: Colors.tealAccent, fontWeight: FontWeight.bold, fontSize: 24, shadows: [Shadow(blurRadius: 10, color: Colors.black)]),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildBottomHUD() {
    final s = _state!;
    return Align(
      alignment: Alignment.bottomCenter,
      child: Container(
        padding: const EdgeInsets.all(24),
        decoration: const BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('Next Pallet', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text(s.activeInstruction?.palletId ?? 'COMPLETE', style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                    Text(s.activeInstruction?.cargoType ?? '', style: const TextStyle(color: Colors.teal)),
                  ],
                ),
                CircularProgressIndicator(
                  value: s.balanceScorePct / 100,
                  backgroundColor: Colors.grey[300],
                  color: s.balanceScorePct > 90 ? Colors.green : Colors.orange,
                ),
              ],
            ),
            const SizedBox(height: 24),
            const Text('Trailer Balance Score', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            LinearProgressIndicator(
              value: s.balanceScorePct / 100,
              backgroundColor: Colors.grey[300],
              color: s.balanceScorePct > 90 ? Colors.green : Colors.orange,
              minHeight: 12,
            ),
            const SizedBox(height: 4),
            Text('${s.balanceScorePct}% - DOT Compliant Axle Weight', style: const TextStyle(color: Colors.grey, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}
