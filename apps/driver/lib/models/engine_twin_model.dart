class EngineComponent {
  final String id;
  final String name;
  final double tempFahrenheit;
  final double pressurePsi;
  final String status; // "Nominal", "Warning", "Critical Failure"

  EngineComponent({
    required this.id,
    required this.name,
    required this.tempFahrenheit,
    required this.pressurePsi,
    required this.status,
  });
}

class EngineTwinSession {
  final String connectionStatus; // "J1939 CAN Bus Active", "FAULT CODE P0234 DETECTED"
  final String? activeFaultCode;
  final bool isDiagnosticsActive;
  final List<EngineComponent> components;

  EngineTwinSession({
    required this.connectionStatus,
    this.activeFaultCode,
    required this.isDiagnosticsActive,
    required this.components,
  });
}
