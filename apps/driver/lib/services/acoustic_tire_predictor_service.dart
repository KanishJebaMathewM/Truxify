import 'dart:async';
import '../models/acoustic_tire_predictor_model.dart';

class AcousticTirePredictorService {
  final _telemetryController = StreamController<AcousticAnalysisStatus>.broadcast();

  Stream<AcousticAnalysisStatus> get analysisStream => _telemetryController.stream;

  void simulateDriving() async {
    // 1. Driving normally, all tires healthy
    _telemetryController.add(AcousticAnalysisStatus(
      isListening: true,
      hasCriticalWarning: false,
      tireData: [
        TireHarmonicData(tirePosition: 'Steer Left', currentFrequencyHz: 440.0, baselineFrequencyHz: 440.0, anomalyScore: 0.05, status: 'Normal'),
        TireHarmonicData(tirePosition: 'Steer Right', currentFrequencyHz: 441.0, baselineFrequencyHz: 440.0, anomalyScore: 0.06, status: 'Normal'),
        TireHarmonicData(tirePosition: 'Drive Left Outer', currentFrequencyHz: 438.0, baselineFrequencyHz: 440.0, anomalyScore: 0.04, status: 'Normal'),
        TireHarmonicData(tirePosition: 'Drive Right Outer', currentFrequencyHz: 442.0, baselineFrequencyHz: 440.0, anomalyScore: 0.08, status: 'Normal'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Drive Right Outer starts resonating abnormally (steel belt fatigue)
    _telemetryController.add(AcousticAnalysisStatus(
      isListening: true,
      hasCriticalWarning: true,
      tireData: [
        TireHarmonicData(tirePosition: 'Steer Left', currentFrequencyHz: 440.0, baselineFrequencyHz: 440.0, anomalyScore: 0.05, status: 'Normal'),
        TireHarmonicData(tirePosition: 'Steer Right', currentFrequencyHz: 441.0, baselineFrequencyHz: 440.0, anomalyScore: 0.06, status: 'Normal'),
        TireHarmonicData(tirePosition: 'Drive Left Outer', currentFrequencyHz: 438.0, baselineFrequencyHz: 440.0, anomalyScore: 0.04, status: 'Normal'),
        TireHarmonicData(
          tirePosition: 'Drive Right Outer', 
          currentFrequencyHz: 680.0, // Major pitch shift
          baselineFrequencyHz: 440.0, 
          anomalyScore: 0.92, 
          status: 'CRITICAL',
        ),
      ],
    ));
  }

  void dispose() {
    _telemetryController.close();
  }
}
