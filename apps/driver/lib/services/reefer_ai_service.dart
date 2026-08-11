import 'dart:async';
import '../models/reefer_ai_model.dart';

class ReeferAiService {
  final _sessionController = StreamController<ReeferAiSession>.broadcast();

  Stream<ReeferAiSession> get reeferStream => _sessionController.stream;

  void simulateReeferMonitoring() async {
    // 1. Normal Operation
    _sessionController.add(ReeferAiSession(
      status: 'THERMO KING TELEMETRY NOMINAL',
      failureProbability: 2.0,
      systemDirective: null,
      telemetry: ReeferTelemetry(
        currentTempFahrenheit: 34.0, // Keeping produce cold
        targetTempFahrenheit: 34.0,
        compressorCycleTimeMins: 15.0,
        freonPressurePsi: 250.0,
        ambientTempFahrenheit: 85.0,
      ),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. AI detects early warning signs (Temp is still fine, but pressure dropping and compressor running longer)
    _sessionController.add(ReeferAiSession(
      status: 'ANOMALY DETECTED: COMPRESSOR STRAIN',
      failureProbability: 45.0,
      systemDirective: 'AI is analyzing Freon pressure drop relative to ambient temperature.',
      telemetry: ReeferTelemetry(
        currentTempFahrenheit: 34.2, // Temp is barely moving yet
        targetTempFahrenheit: 34.0,
        compressorCycleTimeMins: 38.0, // Running way too long to maintain temp
        freonPressurePsi: 190.0, // Pressure dropping
        ambientTempFahrenheit: 88.0,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Imminent Failure Prediction
    _sessionController.add(ReeferAiSession(
      status: 'CRITICAL PREDICTION: COMPRESSOR FAILURE IMMINENT',
      failureProbability: 98.5,
      systemDirective: 'REROUTING TO THERMO KING DEALER (22 MILES AHEAD). CARGO SPOILAGE IN 3.5 HOURS.',
      telemetry: ReeferTelemetry(
        currentTempFahrenheit: 35.5, // Temp starting to rise
        targetTempFahrenheit: 34.0,
        compressorCycleTimeMins: 60.0, // Running non-stop
        freonPressurePsi: 110.0, // Critical freon leak
        ambientTempFahrenheit: 92.0,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
