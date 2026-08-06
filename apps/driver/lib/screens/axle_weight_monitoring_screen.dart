import 'package:flutter/material.dart';
import '../services/air_suspension_service.dart';

class AxleWeightMonitoringScreen extends StatefulWidget {
  const AxleWeightMonitoringScreen({super.key});

  @override
  State<AxleWeightMonitoringScreen> createState() => _AxleWeightMonitoringScreenState();
}

class _AxleWeightMonitoringScreenState extends State<AxleWeightMonitoringScreen> {
  final AirSuspensionService _airSuspensionService = AirSuspensionService();
  AxleWeights? _currentWeights;

  final double steerLimit = 12000;
  final double driveLimit = 34000;
  final double trailerLimit = 34000;

  @override
  void initState() {
    super.initState();
    _airSuspensionService.weightStream.listen((weights) {
      if (mounted) {
        setState(() {
          _currentWeights = weights;
        });
      }
    });
    _airSuspensionService.startSimulation();
  }

  @override
  void dispose() {
    _airSuspensionService.dispose();
    super.dispose();
  }

  Color _getHeatmapColor(double weight, double limit) {
    if (weight > limit) return Colors.red;
    if (weight > limit * 0.9) return Colors.orange;
    return Colors.green;
  }

  Widget _buildAxleHeatmap(String label, double weight, double limit, bool isTandem) {
    final color = _getHeatmapColor(weight, limit);
    return Column(
      children: [
        Text(label, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
        const SizedBox(height: 8),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            _buildTirePair(color, isTandem),
            Container(width: 80, height: 12, color: Colors.blueGrey[800]), // Axle bar
            _buildTirePair(color, isTandem),
          ],
        ),
        const SizedBox(height: 8),
        Text('${weight.toStringAsFixed(0)} / ${limit.toStringAsFixed(0)} lbs',
            style: TextStyle(color: color, fontWeight: FontWeight.bold, fontSize: 16)),
      ],
    );
  }

  Widget _buildTirePair(Color color, bool isTandem) {
    return Column(
      children: [
        Container(
          width: 24,
          height: 48,
          decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6)),
        ),
        if (isTandem) const SizedBox(height: 4),
        if (isTandem)
          Container(
            width: 24,
            height: 48,
            decoration: BoxDecoration(color: color, borderRadius: BorderRadius.circular(6)),
          ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    bool hasImbalance = false;
    if (_currentWeights != null) {
      if (_currentWeights!.steerWeight > steerLimit ||
          _currentWeights!.driveWeight > driveLimit ||
          _currentWeights!.trailerWeight > trailerLimit) {
        hasImbalance = true;
      }
    }

    return Scaffold(
      appBar: AppBar(
        title: const Text('Live Axle Heatmap'),
        backgroundColor: Colors.blueGrey[900],
      ),
      body: _currentWeights == null
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                if (hasImbalance)
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    color: Colors.red[900],
                    child: const Row(
                      children: [
                        Icon(Icons.warning, color: Colors.white, size: 48),
                        SizedBox(width: 16),
                        Expanded(
                          child: Text(
                            'LOAD SHIFT DETECTED!\nImmediate axle weight violation. Pull over and adjust load.',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
                          ),
                        ),
                      ],
                    ),
                  )
                else
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(24),
                    color: Colors.green[800],
                    child: const Row(
                      children: [
                        Icon(Icons.check_circle, color: Colors.white, size: 48),
                        SizedBox(width: 16),
                        Expanded(
                          child: Text(
                            'AXLE WEIGHTS LEGAL\nLoad is properly distributed.',
                            style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
                          ),
                        ),
                      ],
                    ),
                  ),
                Expanded(
                  child: Container(
                    color: Colors.grey[200],
                    child: Center(
                      child: SingleChildScrollView(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            _buildAxleHeatmap('Steer Axle', _currentWeights!.steerWeight, steerLimit, false),
                            const SizedBox(height: 60),
                            _buildAxleHeatmap('Drive Axles', _currentWeights!.driveWeight, driveLimit, true),
                            const SizedBox(height: 100),
                            _buildAxleHeatmap('Trailer Axles', _currentWeights!.trailerWeight, trailerLimit, true),
                          ],
                        ),
                      ),
                    ),
                  ),
                ),
              ],
            ),
    );
  }
}
