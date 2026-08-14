class Pallet {
  final String id;
  final double weightLbs;
  double positionX; // 0.0 to 1.0 (Front to Back)

  Pallet({
    required this.id,
    required this.weightLbs,
    this.positionX = 0.5,
  });
}

class WeightDistributionSession {
  final String status;
  final double steerAxleWeight;
  final double driveAxleWeight;
  final double tandemAxleWeight;
  
  final double steerLimit; // e.g. 12000
  final double driveLimit; // e.g. 34000
  final double tandemLimit; // e.g. 34000

  final List<Pallet> pallets;

  WeightDistributionSession({
    required this.status,
    required this.steerAxleWeight,
    required this.driveAxleWeight,
    required this.tandemAxleWeight,
    required this.steerLimit,
    required this.driveLimit,
    required this.tandemLimit,
    required this.pallets,
  });
}
