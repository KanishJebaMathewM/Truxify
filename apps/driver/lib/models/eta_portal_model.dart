class PortalState {
  final String status;
  final bool isGeneratingLink;
  final String? secureTrackingUrl;
  final String? generatedPassword;
  final DateTime? estimatedTimeOfArrival;
  final String? trafficConditions;
  final int milesRemaining;

  PortalState({
    required this.status,
    required this.isGeneratingLink,
    this.secureTrackingUrl,
    this.generatedPassword,
    this.estimatedTimeOfArrival,
    this.trafficConditions,
    required this.milesRemaining,
  });
}
