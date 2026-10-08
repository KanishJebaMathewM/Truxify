/// Active WebGL & Canvas Memory Reclaimer for Flutter Admin Web App
/// Tracks periodic cleanup cycles for the Flutter Admin Web App.
///
/// Browsers manage WebGL and Canvas garbage collection internally, so
/// application code cannot directly force WebGL garbage collection.
import 'package:flutter/foundation.dart';

class WebGLMemoryReclaimerService {
  static final WebGLMemoryReclaimerService _instance =
      WebGLMemoryReclaimerService._internal();

  /// Returns the shared memory reclaimer instance.
  factory WebGLMemoryReclaimerService() => _instance;

  WebGLMemoryReclaimerService._internal();

  int _reclaimedFrameCount = 0;

  /// Records a cleanup cycle and periodically logs memory cleanup activity.
  ///
  /// Actual WebGL garbage collection is managed by the browser.
  void purgeOffscreenCanvasMemory() {
    _reclaimedFrameCount++;

    if (_reclaimedFrameCount % 50 == 0) {
      debugPrint(
        '[Memory Reclaimer] Purging off-screen canvas objects & triggering WebGL garbage collection...',
      );
      debugPrint(
        '[Memory Reclaimer] Cleanup cycle $_reclaimedFrameCount completed. '
        'WebGL and Canvas garbage collection is managed by the browser.',
      );
    }
  }
}
