class FuelBlendOption {
  final String blendName; // "B20", "B5", "Ultra Low Sulfur Diesel (ULSD)"
  final double pricePerGallon;
  final bool isRecommended;
  final String safetyStatus; // "Safe", "Risk of Gelling", "DPF Clog Risk"
  final String reason;

  FuelBlendOption({
    required this.blendName,
    required this.pricePerGallon,
    required this.isRecommended,
    required this.safetyStatus,
    required this.reason,
  });
}

class FuelOptimizationAnalysis {
  final String locationName;
  final double routeMinTempF; // Lowest temp on upcoming route
  final double averageEngineLoadPct; // Past 24h engine load
  final List<FuelBlendOption> availableBlends;
  final double estimatedSavings;

  FuelOptimizationAnalysis({
    required this.locationName,
    required this.routeMinTempF,
    required this.averageEngineLoadPct,
    required this.availableBlends,
    required this.estimatedSavings,
  });
}
