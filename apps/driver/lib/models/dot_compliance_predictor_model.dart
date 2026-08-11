class ClinicOption {
  final String clinicName;
  final String location;
  final double distanceMiles;
  final double deviationFromRouteMiles;

  ClinicOption({
    required this.clinicName,
    required this.location,
    required this.distanceMiles,
    required this.deviationFromRouteMiles,
  });
}

class ComplianceDocument {
  final String documentType; // e.g. "DOT Medical Card", "CDL Class A"
  final DateTime expirationDate;
  final bool isWarningActive;
  final int daysRemaining;
  final List<ClinicOption>? suggestedClinics;

  ComplianceDocument({
    required this.documentType,
    required this.expirationDate,
    required this.isWarningActive,
    required this.daysRemaining,
    this.suggestedClinics,
  });
}
