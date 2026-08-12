class FluidDynamics {
  final String fluidType; // "Milk", "Chemical Solvent"
  final double volumeGallons;
  final double viscosityMultiplier; // e.g., 1.0 for water, higher for thick fluids
  final double currentSloshFactor; // 0.0 to 1.0 (1.0 being maximum violence)

  FluidDynamics({
    required this.fluidType,
    required this.volumeGallons,
    required this.viscosityMultiplier,
    required this.currentSloshFactor,
  });
}

class TankerCgSession {
  final String status; // "Nominal Stability", "ROLLOVER WARNING: REDUCE SPEED"
  final double currentSpeedMph;
  final double lateralGForce; // Turning
  final double longitudinalGForce; // Braking/Accel
  final double rolloverThresholdPercent; // 100% means rollover is imminent
  final FluidDynamics fluid;

  TankerCgSession({
    required this.status,
    required this.currentSpeedMph,
    required this.lateralGForce,
    required this.longitudinalGForce,
    required this.rolloverThresholdPercent,
    required this.fluid,
  });
}
