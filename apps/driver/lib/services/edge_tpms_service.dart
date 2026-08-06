import 'dart:async';

class TpmsAlert {
  final String tireId;
  final double pressureDrop;
  final int timeWindowMs;
  final String message;

  TpmsAlert({
    required this.tireId,
    required this.pressureDrop,
    required this.timeWindowMs,
    required this.message,
  });
}

class TpmsReading {
  final double pressurePsi;
  final int timestampMs;

  TpmsReading(this.pressurePsi, this.timestampMs);
}

class EdgeTpmsService {
  final _alertController = StreamController<TpmsAlert>.broadcast();
  Stream<TpmsAlert> get alertStream => _alertController.stream;

  // Map to store recent readings per tire
  final Map<String, List<TpmsReading>> _readingsWindow = {};

  // Constants for rapid deflation detection
  static const int windowSizeMs = 1000;
  static const double criticalDropPsi = 3.0;

  void processReading(String tireId, double pressurePsi, int timestampMs) {
    if (!_readingsWindow.containsKey(tireId)) {
      _readingsWindow[tireId] = [];
    }
    final readings = _readingsWindow[tireId]!;

    readings.add(TpmsReading(pressurePsi, timestampMs));

    // Remove old readings outside the time window
    readings.removeWhere((r) => timestampMs - r.timestampMs > windowSizeMs);

    if (readings.length >= 2) {
      final oldest = readings.first;
      final newest = readings.last;
      final drop = oldest.pressurePsi - newest.pressurePsi;
      final timeDiff = newest.timestampMs - oldest.timestampMs;

      if (drop >= criticalDropPsi && timeDiff <= windowSizeMs) {
        _alertController.add(
          TpmsAlert(
            tireId: tireId,
            pressureDrop: drop,
            timeWindowMs: timeDiff,
            message: 'CRITICAL: Rapid deflation detected on $tireId! Pull over immediately.',
          ),
        );
        // Clear window to prevent spamming alerts for the same event
        readings.clear();
      }
    }
  }

  void simulateHighFrequencyData() {
    // Simulate normal readings
    int timestamp = DateTime.now().millisecondsSinceEpoch;
    final timer = Timer.periodic(const Duration(milliseconds: 100), (timer) {
      timestamp += 100;
      processReading('Drive Axle 2 - Outer Right', 100.0, timestamp);
      
      // Simulate blowout at tick 30
      if (timer.tick == 30) {
        processReading('Drive Axle 2 - Outer Right', 98.0, timestamp + 10);
        processReading('Drive Axle 2 - Outer Right', 95.0, timestamp + 20);
        processReading('Drive Axle 2 - Outer Right', 90.0, timestamp + 30);
      }

      if (timer.tick > 35) {
        timer.cancel();
      }
    });
  }

  void dispose() {
    _alertController.close();
  }
}
