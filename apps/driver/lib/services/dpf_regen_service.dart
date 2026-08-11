import 'dart:async';
import '../models/dpf_regen_model.dart';

class DpfRegenService {
  final _sessionController = StreamController<DpfRegenSession>.broadcast();

  Stream<DpfRegenSession> get regenStream => _sessionController.stream;

  void simulateDpfMonitoring() async {
    // 1. Cruising, soot level rising
    _sessionController.add(DpfRegenSession(
      status: 'Soot Level Nominal - Monitoring',
      predictedRegenTime: null,
      isRegenActive: false,
      estimatedMinutesRemaining: 0,
      telemetry: DpfTelemetry(
        sootLoadPercentage: 68.5,
        exhaustTempFahrenheit: 550.0,
        engineLoadPercentage: 75.0,
      ),
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. High soot, scheduling for sleeper berth
    final overnightTime = DateTime.now().add(const Duration(hours: 4)); // Scheduled for 4 hours from now
    _sessionController.add(DpfRegenSession(
      status: 'CRITICAL SOOT: PREDICTIVE SCHEDULING',
      predictedRegenTime: overnightTime,
      isRegenActive: false,
      estimatedMinutesRemaining: 45,
      telemetry: DpfTelemetry(
        sootLoadPercentage: 88.0, // High soot
        exhaustTempFahrenheit: 560.0,
        engineLoadPercentage: 78.0,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Simulating the overnight active regen
    _sessionController.add(DpfRegenSession(
      status: 'ACTIVE PARKED REGEN IN PROGRESS',
      predictedRegenTime: DateTime.now(),
      isRegenActive: true,
      estimatedMinutesRemaining: 42,
      telemetry: DpfTelemetry(
        sootLoadPercentage: 86.5, // Burning down
        exhaustTempFahrenheit: 1100.0, // Massive heat to burn soot
        engineLoadPercentage: 45.0, // High idle
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
