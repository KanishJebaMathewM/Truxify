class CustomsManifest {
  final String manifestId;
  final String portOfEntry;
  final String borderAgency; // 'US CBP (ACE)', 'Canada CBSA (ACI)'
  final String status; // 'Drafting', 'Submitted', 'Accepted - Pre-cleared', 'Rejected'
  final String scacCode;
  final String tripNumber;
  final DateTime estimatedArrival;
  final List<String> issues; // e.g. 'Missing Commercial Invoice'

  CustomsManifest({
    required this.manifestId,
    required this.portOfEntry,
    required this.borderAgency,
    required this.status,
    required this.scacCode,
    required this.tripNumber,
    required this.estimatedArrival,
    this.issues = const [],
  });
}
