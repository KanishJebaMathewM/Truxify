import 'dart:async';
import '../models/air_brake_diagnostic_model.dart';

class AirBrakeDiagnosticService {
  final _sessionController = StreamController<AirBrakeDiagnosticSession>.broadcast();

  Stream<AirBrakeDiagnosticSession> get diagnosticStream => _sessionController.stream;

  void simulateDiagnosticScan() async {
    // 1. Initial State - Scanning
    _sessionController.add(AirBrakeDiagnosticSession(
      status: 'Acoustic Triangulation Active...',
      isScanning: true,
      systemPsi: 115.0, // Slowly dropping
      detectedLeak: null,
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Anomaly Detected
    _sessionController.add(AirBrakeDiagnosticSession(
      status: 'High-Frequency Anomaly Detected. Isolating...',
      isScanning: true,
      systemPsi: 112.5,
      detectedLeak: AirBrakeLeak(
        componentName: 'Unknown Fitting',
        locationArea: 'Trailer Area',
        severityPsiDropPerMin: 1.5,
        acousticConfidence: 45.0,
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Leak Pinpointed
    _sessionController.add(AirBrakeDiagnosticSession(
      status: 'LEAK PINPOINTED: RED SERVICE GLADHAND',
      isScanning: false,
      systemPsi: 108.0,
      detectedLeak: AirBrakeLeak(
        componentName: 'Red Emergency Service Gladhand Seal',
        locationArea: 'Trailer Nose Connection',
        severityPsiDropPerMin: 2.1, // DOT Violation if > 2psi
        acousticConfidence: 98.5,
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
