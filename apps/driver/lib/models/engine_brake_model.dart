class EngineBrakeSession {
  final String status; // "Approaching Ordinance Zone...", "JAKE BRAKE DISABLED"
  final String location; // "Open Highway", "City of Denver, CO"
  final bool isRestrictedZone;
  final bool isEngineBrakeActive; // true if ECM allows it, false if ECM disabled it
  final int fineAvoidedUsd; // Accumulates potential fines avoided

  EngineBrakeSession({
    required this.status,
    required this.location,
    required this.isRestrictedZone,
    required this.isEngineBrakeActive,
    required this.fineAvoidedUsd,
  });
}
