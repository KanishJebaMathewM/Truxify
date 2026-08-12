class DetentionEscrowSession {
  final String facilityName;
  final String facilityGeofenceId;
  final String status; // "Loading - Grace Period", "Detention Active - Draining Escrow"
  final DateTime arrivalTime;
  final int gracePeriodMinutes;
  final int currentDwellMinutes;
  final double detentionRatePerHour;
  final double accumulatedDetentionPay;
  final String smartContractHash;

  DetentionEscrowSession({
    required this.facilityName,
    required this.facilityGeofenceId,
    required this.status,
    required this.arrivalTime,
    required this.gracePeriodMinutes,
    required this.currentDwellMinutes,
    required this.detentionRatePerHour,
    required this.accumulatedDetentionPay,
    required this.smartContractHash,
  });
}
