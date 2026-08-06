import 'dart:async';

class AxleWeights {
  final double steerWeight;
  final double driveWeight;
  final double trailerWeight;

  const AxleWeights({
    required this.steerWeight,
    required this.driveWeight,
    required this.trailerWeight,
  });
}

class AirSuspensionService {
  final _controller = StreamController<AxleWeights>.broadcast();
  Stream<AxleWeights> get weightStream => _controller.stream;
  Timer? _timer;

  void startSimulation() {
    int tick = 0;
    _timer = Timer.periodic(const Duration(seconds: 1), (timer) {
      tick++;
      if (tick < 5) {
        // Normal loads
        _controller.add(const AxleWeights(
          steerWeight: 11500,
          driveWeight: 31000,
          trailerWeight: 32000,
        ));
      } else if (tick < 10) {
        // Load shift -> Drive overweight
        _controller.add(const AxleWeights(
          steerWeight: 11000,
          driveWeight: 35500, // OVERWEIGHT (>34,000)
          trailerWeight: 28000,
        ));
      } else {
        // Return to normal
        _controller.add(const AxleWeights(
          steerWeight: 11500,
          driveWeight: 31000,
          trailerWeight: 32000,
        ));
        if (tick >= 15) {
          tick = 0; // loop simulation
        }
      }
    });
  }

  void dispose() {
    _timer?.cancel();
    _controller.close();
  }
}
