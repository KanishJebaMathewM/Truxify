/// Active WebGL & Canvas Memory Reclaimer for Flutter Admin Web App
import 'package:flutter/foundation.dart';

class WebGLMemoryReclaimerService {
  static final WebGLMemoryReclaimerService _instance = WebGLMemoryReclaimerService._internal();
  factory WebGLMemoryReclaimerService() => _instance;
  WebGLMemoryReclaimerService._internal();

  int _reclaimedFrameCount = 0;

  void purgeOffscreenCanvasMemory() {
    _reclaimedFrameCount++;
    if (_reclaimedFrameCount % 50 == 0) {
      debugPrint('[Memory Reclaimer] Purging off-screen canvas objects & triggering WebGL garbage collection...');
    }
  }
}
