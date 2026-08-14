import 'dart:async';
import '../models/tanker_cg_model.dart';

class TankerCgService {
  final _sessionController = StreamController<TankerCgSession>.broadcast();

  Stream<TankerCgSession> get cgStream => _sessionController.stream;

  void simulateOffRampCornering() async {
    final fluid = FluidDynamics(
      fluidType: 'Raw Milk (Low Viscosity)',
      volumeGallons: 6000,
      viscosityMultiplier: 0.8,
      currentSloshFactor: 0.1,
    );

    // 1. Cruising
    _sessionController.add(TankerCgSession(
      status: 'Center of Gravity: Stable',
      currentSpeedMph: 65.0,
      lateralGForce: 0.0,
      longitudinalGForce: 0.0,
      rolloverThresholdPercent: 10.0,
      fluid: fluid,
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Entering off-ramp too fast
    _sessionController.add(TankerCgSession(
      status: 'FLUID SHIFT DETECTED: REDUCE SPEED',
      currentSpeedMph: 55.0,
      lateralGForce: 0.4, // Pulling to the side
      longitudinalGForce: -0.3, // Hard braking
      rolloverThresholdPercent: 75.0,
      fluid: FluidDynamics(
        fluidType: fluid.fluidType,
        volumeGallons: fluid.volumeGallons,
        viscosityMultiplier: fluid.viscosityMultiplier,
        currentSloshFactor: 0.85, // Massive fluid surge to front-right
      ),
    ));
    
    await Future.delayed(const Duration(seconds: 4));

    // 3. Driver corrects
    _sessionController.add(TankerCgSession(
      status: 'Stability Restored',
      currentSpeedMph: 25.0,
      lateralGForce: 0.1,
      longitudinalGForce: -0.1,
      rolloverThresholdPercent: 20.0,
      fluid: FluidDynamics(
        fluidType: fluid.fluidType,
        volumeGallons: fluid.volumeGallons,
        viscosityMultiplier: fluid.viscosityMultiplier,
        currentSloshFactor: 0.2, // Slosh settling
      ),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
