import 'package:flutter/foundation.dart';

class WebGLMemoryReclaimerService {
  static final WebGLMemoryReclaimerService _instance =
      WebGLMemoryReclaimerService._internal();

  factory WebGLMemoryReclaimerService() {
    return _instance;
  }

  WebGLMemoryReclaimerService._internal();

  int _reclaimedFrameCount = 0;

  void purgeOffscreenCanvasMemory() {
    _reclaimedFrameCount++;

    if (_reclaimedFrameCount % 50 == 0) {
      debugPrint(
        '[Memory Reclaimer] Processed $_reclaimedFrameCount frames.',
      );
    }
  }
}
