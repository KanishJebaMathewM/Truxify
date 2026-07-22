import 'dart:async';
import 'dart:math' as math;

class GpsPoint {
  const GpsPoint({
    required this.latitude,
    required this.longitude,
    required this.timestampMs,
  });

  final double latitude;
  final double longitude;
  final int timestampMs;
}

class GpsBatch {
  const GpsBatch(this.points);

  final List<GpsPoint> points;
}

class GpsDeltaCompressor {
  GpsDeltaCompressor({
    this.minDistanceMeters = 25.0,
    this.flushInterval = const Duration(seconds: 30),
  }) {
    _timer = Timer.periodic(flushInterval, (_) => _flush());
  }

  final double minDistanceMeters;
  final Duration flushInterval;

  final List<GpsPoint> _buffer = <GpsPoint>[];
  final List<GpsBatch> _pending = <GpsBatch>[];
  Timer? _timer;

  List<GpsBatch> add(GpsPoint point) {
    final flushed = <GpsBatch>[];

    if (_buffer.isEmpty) {
      _buffer.add(point);
      return flushed;
    }

    final previous = _buffer.last;
    final moved = _distanceMeters(previous, point) >= minDistanceMeters;
    final elapsed = point.timestampMs - previous.timestampMs >= flushInterval.inMilliseconds;

    _buffer.add(point);

    if (moved || elapsed) {
      final batch = GpsBatch(List<GpsPoint>.of(_buffer));
      _pending.add(batch);
      flushed.add(batch);
      _buffer.clear();
    }

    return flushed;
  }

  List<GpsBatch> drain() {
    final flushed = List<GpsBatch>.of(_pending);
    _pending.clear();

    if (_buffer.isNotEmpty) {
      flushed.add(GpsBatch(List<GpsPoint>.of(_buffer)));
      _buffer.clear();
    }

    return flushed;
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
  }

  void _flush() {
    if (_buffer.isNotEmpty) {
      _pending.add(GpsBatch(List<GpsPoint>.of(_buffer)));
      _buffer.clear();
    }
  }

  static double _distanceMeters(GpsPoint from, GpsPoint to) {
    const earthRadiusMeters = 6371000.0;
    final lat1 = _toRadians(from.latitude);
    final lat2 = _toRadians(to.latitude);
    final deltaLat = _toRadians(to.latitude - from.latitude);
    final deltaLng = _toRadians(to.longitude - from.longitude);

    final a = math.sin(deltaLat / 2) * math.sin(deltaLat / 2) +
        math.cos(lat1) * math.cos(lat2) * math.sin(deltaLng / 2) * math.sin(deltaLng / 2);
    final c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
    return earthRadiusMeters * c;
  }

  static double _toRadians(double degrees) => degrees * math.pi / 180.0;
}

class GpsCompressionStats {
  int originalPoints = 0;
  int compressedPoints = 0;
  int totalOriginalBytes = 0;
  int totalCompressedBytes = 0;

  double get compressionRatio => totalOriginalBytes > 0 ? (1 - totalCompressedBytes / totalOriginalBytes) * 100 : 0;
  int get pointsSaved => originalPoints - compressedPoints;

  void record(int origBytes, int compBytes) {
    originalPoints++;
    compressedPoints++;
    totalOriginalBytes += origBytes;
    totalCompressedBytes += compBytes;
  }

  void recordSkip() { originalPoints++; }

  String get summary => 'compressionRatio:F1 pointsSaved points saved';
}
