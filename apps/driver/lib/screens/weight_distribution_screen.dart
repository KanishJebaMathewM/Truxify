import 'package:flutter/material.dart';
import '../models/weight_distribution_model.dart';
import '../services/weight_distribution_service.dart';

class WeightDistributionScreen extends StatefulWidget {
  const WeightDistributionScreen({super.key});

  @override
  State<WeightDistributionScreen> createState() => _WeightDistributionScreenState();
}

class _WeightDistributionScreenState extends State<WeightDistributionScreen> {
  final WeightDistributionService _service = WeightDistributionService();
  WeightDistributionSession? _session;

  @override
  void initState() {
    super.initState();
    _service.weightStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.initializeSimulation();
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
        title: const Text('Trailer Physics Simulator'),
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
          child: Column(
            children: [
              _buildAxleGauges(s),
              const Expanded(child: SizedBox()),
              _buildTrailerSimulator(s),
              const Expanded(child: SizedBox()),
              const Padding(
                padding: EdgeInsets.all(16),
                child: Text('Drag pallets across the trailer to simulate weight shift on the axles.', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold, fontStyle: FontStyle.italic)),
              ),
              const SizedBox(height: 32),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(WeightDistributionSession s) {
    bool isLegal = s.status.contains('LEGAL');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isLegal ? Colors.green[800] : Colors.red[900],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isLegal ? Icons.scale : Icons.warning, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('LOAD BALANCE AI', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildAxleGauges(WeightDistributionSession s) {
    return Container(
      padding: const EdgeInsets.all(16),
      color: Colors.white,
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceAround,
        children: [
          _buildGauge('STEER', s.steerAxleWeight, s.steerLimit),
          _buildGauge('DRIVE', s.driveAxleWeight, s.driveLimit),
          _buildGauge('TANDEM', s.tandemAxleWeight, s.tandemLimit),
        ],
      ),
    );
  }

  Widget _buildGauge(String name, double weight, double limit) {
    bool isOver = weight > limit;
    double percentage = (weight / limit).clamp(0.0, 1.0);

    return Column(
      children: [
        Text(name, style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Stack(
          alignment: Alignment.center,
          children: [
            SizedBox(
              width: 80,
              height: 80,
              child: CircularProgressIndicator(
                value: percentage,
                backgroundColor: Colors.grey[300],
                color: isOver ? Colors.red : Colors.green,
                strokeWidth: 8,
              ),
            ),
            Text('${(weight / 1000).toStringAsFixed(1)}k', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: isOver ? Colors.red : Colors.black87)),
          ],
        ),
        const SizedBox(height: 8),
        Text('Limit: ${(limit / 1000).toStringAsFixed(0)}k', style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }

  Widget _buildTrailerSimulator(WeightDistributionSession s) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16),
      height: 150,
      child: Stack(
        children: [
          // Trailer Outline
          Positioned.fill(
            child: Container(
              decoration: BoxDecoration(
                color: Colors.blueGrey[100],
                border: Border.all(color: Colors.blueGrey, width: 4),
                borderRadius: const BorderRadius.only(topRight: Radius.circular(8), bottomRight: Radius.circular(8)),
              ),
              child: const Center(child: Text('53ft Trailer', style: TextStyle(color: Colors.blueGrey, fontSize: 24, fontWeight: FontWeight.bold, letterSpacing: 4.0))),
            ),
          ),
          
          // Truck Cab Indicator (Left Side)
          Positioned(
            left: 0,
            top: 20,
            bottom: 20,
            child: Container(
              width: 20,
              color: Colors.black87,
              child: const RotatedBox(quarterTurns: 3, child: Center(child: Text('FRONT', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)))),
            ),
          ),

          // Render Interactive Pallets
          ...s.pallets.map((p) => _buildDraggablePallet(p)),
        ],
      ),
    );
  }

  Widget _buildDraggablePallet(Pallet p) {
    return LayoutBuilder(
      builder: (context, constraints) {
        // Calculate raw X position based on percentage
        double rawX = p.positionX * constraints.maxWidth;
        // Keep pallet inside bounds (assuming pallet width is 60)
        double boundedX = rawX.clamp(20.0, constraints.maxWidth - 60.0);

        return Positioned(
          left: boundedX,
          top: 30,
          child: GestureDetector(
            onPanUpdate: (details) {
              double newX = boundedX + details.delta.dx;
              double percentageX = newX / constraints.maxWidth;
              _service.updatePalletPosition(p.id, percentageX);
            },
            child: Container(
              width: 60,
              height: 80,
              decoration: BoxDecoration(
                color: Colors.brown[400],
                border: Border.all(color: Colors.brown[800]!, width: 2),
                borderRadius: BorderRadius.circular(4),
                boxShadow: const [BoxShadow(color: Colors.black26, offset: Offset(2, 2), blurRadius: 4)],
              ),
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    const Icon(Icons.drag_indicator, color: Colors.white54, size: 16),
                    const SizedBox(height: 4),
                    Text('${(p.weightLbs / 1000).toStringAsFixed(1)}k', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
                  ],
                ),
              ),
            ),
          ),
        );
      }
    );
  }
}
