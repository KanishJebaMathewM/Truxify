import 'dart:async';
import '../models/acoustic_tire_predictor_model.dart';

class AcousticTirePredictorService {
  final _analysisController = StreamController<TireAcousticAnalysis>.broadcast();

  Stream<TireAcousticAnalysis> get analysisStream => _analysisController.stream;

  void simulateAcousticAnalysis() async {
    // 1. Normal Highway Driving (Normal Road Noise)
    _analysisController.add(TireAcousticAnalysis(
      status: 'Monitoring Ambient Road Noise',
      activeTireLocation: 'All Tires',
      confidencePct: 99.9,
      estimatedMinutesToFailure: 999,
      signatures: [
        AcousticHarmonicSignature(frequencyHz: 120.0, amplitudeDb: 65.0, isAnomalous: false), // Normal low hum
        AcousticHarmonicSignature(frequencyHz: 400.0, amplitudeDb: 55.0, isAnomalous: false), // Wind noise
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Early Warning (High pitch whine starts - Belt Separation)
    _analysisController.add(TireAcousticAnalysis(
      status: 'Warning - Internal Belt Separation',
      activeTireLocation: 'Passenger Side - Trailer Axle 2 - Outer',
      confidencePct: 75.5,
      estimatedMinutesToFailure: 45,
      signatures: [
        AcousticHarmonicSignature(frequencyHz: 120.0, amplitudeDb: 65.0, isAnomalous: false),
        AcousticHarmonicSignature(frequencyHz: 4500.0, amplitudeDb: 82.0, isAnomalous: true), // The whine!
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 3. Critical (Whine gets extremely loud and oscillates)
    _analysisController.add(TireAcousticAnalysis(
      status: 'Critical - Imminent Blowout',
      activeTireLocation: 'Passenger Side - Trailer Axle 2 - Outer',
      confidencePct: 98.2,
      estimatedMinutesToFailure: 3, // Pull over NOW
      signatures: [
        AcousticHarmonicSignature(frequencyHz: 120.0, amplitudeDb: 65.0, isAnomalous: false),
        AcousticHarmonicSignature(frequencyHz: 4500.0, amplitudeDb: 105.0, isAnomalous: true), // Severe whine
        AcousticHarmonicSignature(frequencyHz: 12.0, amplitudeDb: 95.0, isAnomalous: true), // Physical thumping
      ],
    ));
  }

  void dispose() {
    _analysisController.close();
  }
}
