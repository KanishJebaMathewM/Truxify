class ScaleWeightReceipt {
  final double steerAxleWeightLbs; // Legal limit usually 12,000
  final double driveAxleWeightLbs; // Legal limit usually 34,000
  final double trailerAxleWeightLbs; // Legal limit usually 34,000
  final double grossWeightLbs; // Legal limit usually 80,000

  ScaleWeightReceipt({
    required this.steerAxleWeightLbs,
    required this.driveAxleWeightLbs,
    required this.trailerAxleWeightLbs,
    required this.grossWeightLbs,
  });
}

class WeightAdjustmentAdvice {
  final bool isCompliant;
  final String instruction;
  final int holesToSlide;
  final String slideDirection; // "Forward" or "Backward"
  final double estimatedDriveWeightLbs;
  final double estimatedTrailerWeightLbs;

  WeightAdjustmentAdvice({
    required this.isCompliant,
    required this.instruction,
    required this.holesToSlide,
    required this.slideDirection,
    required this.estimatedDriveWeightLbs,
    required this.estimatedTrailerWeightLbs,
  });
}
