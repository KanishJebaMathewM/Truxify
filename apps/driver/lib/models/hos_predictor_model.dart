class HosDriverState {
  final String driverName;
  final double hoursRemainingDaily;
  final double hoursRemainingWeekly;
  final bool isInViolation;

  HosDriverState({
    required this.driverName,
    required this.hoursRemainingDaily,
    required this.hoursRemainingWeekly,
    required this.isInViolation,
  });
}

class HosSimulationResult {
  final String loadId;
  final double requiredTransitHours;
  final bool isViolationInevitable;
  final String violationReason;

  HosSimulationResult({
    required this.loadId,
    required this.requiredTransitHours,
    required this.isViolationInevitable,
    required this.violationReason,
  });
}

class HosPredictorSession {
  final String status;
  final HosDriverState? driverState;
  final HosSimulationResult? simulationResult;
  final bool isSimulating;

  HosPredictorSession({
    required this.status,
    this.driverState,
    this.simulationResult,
    required this.isSimulating,
  });
}
