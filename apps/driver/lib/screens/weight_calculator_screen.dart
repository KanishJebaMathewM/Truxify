import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

class CargoItem {
  double weight; // in lbs
  double position; // in ft from front of trailer

  CargoItem({required this.weight, required this.position});
}

class WeightCalculatorScreen extends StatefulWidget {
  const WeightCalculatorScreen({super.key});

  @override
  State<WeightCalculatorScreen> createState() => _WeightCalculatorScreenState();
}

class _WeightCalculatorScreenState extends State<WeightCalculatorScreen> {
  // Legal limits
  final double steerLimit = 12000;
  final double driveLimit = 34000;
  final double trailerLimit = 34000;
  final double grossLimit = 80000;

  // Empty weights (approximate)
  final double emptySteer = 11000;
  final double emptyDrive = 7000;
  final double emptyTrailer = 14000;
  
  // Dimensions for standard 53ft trailer
  final double kingpinPos = 3.0; // ft from front
  final double tandemPos = 43.0; // ft from front

  List<CargoItem> cargoList = [];

  final _weightController = TextEditingController();
  final _positionController = TextEditingController();

  void _addCargo() {
    final w = double.tryParse(_weightController.text);
    final p = double.tryParse(_positionController.text);
    if (w != null && p != null) {
      setState(() {
        cargoList.add(CargoItem(weight: w, position: p));
      });
      _weightController.clear();
      _positionController.clear();
    }
  }

  void _removeCargo(int index) {
    setState(() {
      cargoList.removeAt(index);
    });
  }

  Map<String, double> _calculateWeights() {
    double steer = emptySteer;
    double drive = emptyDrive;
    double trailer = emptyTrailer;

    // Distribute empty trailer weight: assume 6k on kingpin, 8k on tandems
    // Kingpin weight goes 10% to steer, 90% to drive
    drive += 6000 * 0.9;
    steer += 6000 * 0.1;
    trailer += 8000 - 14000; // Adjust base to actual

    for (final item in cargoList) {
      double distFromKingpin = item.position - kingpinPos;
      double span = tandemPos - kingpinPos;
      
      // Moment balance
      double fracTandem = distFromKingpin / span;
      if (fracTandem < 0) fracTandem = 0; // ahead of kingpin goes 100% to kingpin
      if (fracTandem > 1) fracTandem = 1; // behind tandem goes 100% to tandem
      
      double fracKingpin = 1.0 - fracTandem;

      double wTandem = item.weight * fracTandem;
      double wKingpin = item.weight * fracKingpin;

      trailer += wTandem;
      drive += wKingpin * 0.9;
      steer += wKingpin * 0.1;
    }

    return {
      'steer': steer,
      'drive': drive,
      'trailer': trailer,
      'gross': steer + drive + trailer,
    };
  }

  Widget _buildAxleGauge(String label, double weight, double limit) {
    bool isOver = weight > limit;
    return Container(
      margin: const EdgeInsets.symmetric(vertical: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: isOver ? Colors.red.withOpacity(0.1) : Colors.green.withOpacity(0.1),
        border: Border.all(color: isOver ? Colors.red : Colors.green),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              Text('${weight.toStringAsFixed(0)} lbs', 
                style: TextStyle(
                  color: isOver ? Colors.red : Colors.green,
                  fontWeight: FontWeight.bold,
                  fontSize: 16
                )
              ),
              Text('Limit: ${limit.toStringAsFixed(0)} lbs',
                style: const TextStyle(fontSize: 12, color: Colors.grey)
              ),
            ],
          )
        ],
      ),
    );
  }

  @override
  void dispose() {
    _weightController.dispose();
    _positionController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final weights = _calculateWeights();

    return Scaffold(
      appBar: AppBar(title: const Text('Cargo Weight Calculator')),
      body: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            const Text(
              'Add Cargo Items',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            Row(
              children: [
                Expanded(
                  child: TextField(
                    controller: _weightController,
                    decoration: const InputDecoration(labelText: 'Weight (lbs)'),
                    keyboardType: TextInputType.number,
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _positionController,
                    decoration: const InputDecoration(labelText: 'Pos from Front (ft)'),
                    keyboardType: TextInputType.number,
                  ),
                ),
                IconButton(
                  icon: const Icon(Icons.add_circle, color: Colors.blue),
                  onPressed: _addCargo,
                ),
              ],
            ),
            const SizedBox(height: 16),
            Expanded(
              flex: 1,
              child: ListView.builder(
                itemCount: cargoList.length,
                itemBuilder: (context, index) {
                  final item = cargoList[index];
                  return ListTile(
                    title: Text('${item.weight.toStringAsFixed(0)} lbs'),
                    subtitle: Text('At ${item.position.toStringAsFixed(1)} ft'),
                    trailing: IconButton(
                      icon: const Icon(Icons.delete, color: Colors.red),
                      onPressed: () => _removeCargo(index),
                    ),
                  );
                },
              ),
            ),
            const Divider(),
            const Text(
              'Estimated Axle Weights',
              style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
            ),
            _buildAxleGauge('Steer Axle', weights['steer']!, steerLimit),
            _buildAxleGauge('Drive Axle', weights['drive']!, driveLimit),
            _buildAxleGauge('Trailer Axle', weights['trailer']!, trailerLimit),
            _buildAxleGauge('Gross Weight', weights['gross']!, grossLimit),
          ],
        ),
      ),
    );
  }
}
