import 'dart:async';
import '../models/engine_twin_model.dart';

class EngineTwinService {
  final _sessionController = StreamController<EngineTwinSession>.broadcast();

  Stream<EngineTwinSession> get twinStream => _sessionController.stream;

  void simulateEngineFault() async {
    // 1. Normal State
    _sessionController.add(EngineTwinSession(
      connectionStatus: 'J1939 CAN Bus Active (Cummins X15)',
      activeFaultCode: null,
      isDiagnosticsActive: false,
      components: [
        EngineComponent(id: 'CYL-1', name: 'Cylinder 1', tempFahrenheit: 210, pressurePsi: 2500, status: 'Nominal'),
        EngineComponent(id: 'INJ-4', name: 'Fuel Injector 4', tempFahrenheit: 195, pressurePsi: 35000, status: 'Nominal'),
        EngineComponent(id: 'TRB-1', name: 'VGT Turbocharger', tempFahrenheit: 850, pressurePsi: 32, status: 'Nominal'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Fault Detected - Analyzing
    _sessionController.add(EngineTwinSession(
      connectionStatus: 'FAULT DETECTED: ISOLATING SUBSYSTEM...',
      activeFaultCode: 'P0234 (Turbo Overboost)',
      isDiagnosticsActive: true,
      components: [
        EngineComponent(id: 'CYL-1', name: 'Cylinder 1', tempFahrenheit: 215, pressurePsi: 2500, status: 'Nominal'),
        EngineComponent(id: 'INJ-4', name: 'Fuel Injector 4', tempFahrenheit: 198, pressurePsi: 35000, status: 'Nominal'),
        EngineComponent(id: 'TRB-1', name: 'VGT Turbocharger', tempFahrenheit: 1200, pressurePsi: 48, status: 'Warning'), // Heating up
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Render 3D Highlight
    _sessionController.add(EngineTwinSession(
      connectionStatus: 'TURBOCHARGER ACTUATOR FAILURE',
      activeFaultCode: 'P0234 (Turbo Overboost)',
      isDiagnosticsActive: true,
      components: [
        EngineComponent(id: 'CYL-1', name: 'Cylinder 1', tempFahrenheit: 220, pressurePsi: 2500, status: 'Nominal'),
        EngineComponent(id: 'INJ-4', name: 'Fuel Injector 4', tempFahrenheit: 200, pressurePsi: 35000, status: 'Nominal'),
        EngineComponent(id: 'TRB-1', name: 'VGT Turbocharger', tempFahrenheit: 1450, pressurePsi: 55, status: 'Critical Failure'), // Blown
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
