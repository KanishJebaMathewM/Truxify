import 'dart:async';
import '../models/weight_distribution_model.dart';

class WeightDistributionService {
  final _sessionController = StreamController<WeightDistributionSession>.broadcast();
  
  final double _emptySteer = 11000;
  final double _emptyDrive = 16000;
  final double _emptyTandem = 9000;
  
  List<Pallet> _pallets = [
    Pallet(id: 'P1 (Steel)', weightLbs: 12000, positionX: 0.1), // Heavy, front
    Pallet(id: 'P2 (Steel)', weightLbs: 12000, positionX: 0.9), // Heavy, back
    Pallet(id: 'P3 (Wood)', weightLbs: 4000, positionX: 0.5),   // Light, middle
  ];

  Stream<WeightDistributionSession> get weightStream => _sessionController.stream;

  void initializeSimulation() {
    _calculatePhysics();
  }

  void updatePalletPosition(String id, double newX) {
    for (final pallet in _pallets) {
      if (pallet.id == id) {
        pallet.positionX = newX.clamp(0.0, 1.0);
        _calculatePhysics();
        return;
      }
    }
  }

  void _calculatePhysics() {
    double currentSteer = _emptySteer;
    double currentDrive = _emptyDrive;
    double currentTandem = _emptyTandem;

    // Simplified moment arm calculation
    for (var p in _pallets) {
      if (p.positionX < 0.33) {
        // Front third: mostly Drive axles
        currentDrive += p.weightLbs * 0.8;
        currentSteer += p.weightLbs * 0.1;
        currentTandem += p.weightLbs * 0.1;
      } else if (p.positionX < 0.66) {
        // Middle third: split drive and tandem
        currentDrive += p.weightLbs * 0.5;
        currentTandem += p.weightLbs * 0.5;
      } else {
        // Rear third: mostly Tandem axles
        currentTandem += p.weightLbs * 0.9;
        currentDrive += p.weightLbs * 0.1;
      }
    }

    bool isLegal = currentSteer <= 12000 && currentDrive <= 34000 && currentTandem <= 34000;

    _sessionController.add(WeightDistributionSession(
      status: isLegal ? 'LEGAL: Safe for DOT Scales' : 'OVERWEIGHT AXLE DETECTED',
      steerAxleWeight: currentSteer,
      driveAxleWeight: currentDrive,
      tandemAxleWeight: currentTandem,
      steerLimit: 12000,
      driveLimit: 34000,
      tandemLimit: 34000,
      pallets: List.from(_pallets),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
