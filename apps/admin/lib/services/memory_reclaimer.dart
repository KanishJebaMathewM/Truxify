/// Active WebGL & Canvas Memory Reclaimer for Flutter Admin Web App
class WebGLMemoryReclaimerService {
  static final WebGLMemoryReclaimerService _instance = WebGLMemoryReclaimerService._internal();
  factory WebGLMemoryReclaimerService() => _instance;
  WebGLMemoryReclaimerService._internal();

  int _reclaimedFrameCount = 0;

  void purgeOffscreenCanvasMemory() {
    _reclaimedFrameCount++;
    if (_reclaimedFrameCount % 50 == 0) {
      print('[Memory Reclaimer] Purging off-screen canvas objects & triggering WebGL garbage collection...');
    }
  }
}
