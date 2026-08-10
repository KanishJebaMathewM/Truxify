class BridgeInfrastructure {
  final String bridgeName;
  final String highwayRoute;
  final int structuralLimitLbs;
  final String engineeringStatus; // "Certified", "Structurally Deficient - Restrictions Apply"

  BridgeInfrastructure({
    required this.bridgeName,
    required this.highwayRoute,
    required this.structuralLimitLbs,
    required this.engineeringStatus,
  });
}

class BridgeValidationSession {
  final int truckGrossWeightLbs;
  final String status; // "Route Validated", "Scanning Infrastructure", "ROUTING BLOCKED - WEIGHT LIMIT EXCEEDED"
  final BridgeInfrastructure? nextBridge;
  final bool isSafeToCross;
  final int? weightDeltaLbs;

  BridgeValidationSession({
    required this.truckGrossWeightLbs,
    required this.status,
    required this.nextBridge,
    required this.isSafeToCross,
    this.weightDeltaLbs,
  });
}
