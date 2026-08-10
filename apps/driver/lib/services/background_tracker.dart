import 'dart:async';
import 'dart:isolate';
import 'isolate_handler.dart';

/// Flutter Background Isolate Engine Thread Pool Service
class BackgroundTrackerService {
  Isolate? _isolate;
  SendPort? _workerSendPort;
  final ReceivePort _mainReceivePort = ReceivePort();
  final _locationController = StreamController<Map<String, dynamic>>.broadcast();

  Stream<Map<String, dynamic>> get locationStream => _locationController.stream;

  Future<void> startBackgroundTracking() async {
    if (_isolate != null) return;

    _isolate = await Isolate.spawn(isolateWorkerEntryPoint, _mainReceivePort.sendPort);

    _mainReceivePort.listen((message) {
      if (message is SendPort) {
        _workerSendPort = message;
      } else if (message is Map<String, dynamic>) {
        _locationController.add(message);
      }
    });
  }

  void processLocationPing(Map<String, dynamic> rawLocationData) {
    _workerSendPort?.send(rawLocationData);
  }

  void stopBackgroundTracking() {
    _isolate?.kill(priority: Isolate.immediate);
    _isolate = null;
    _workerSendPort = null;
  }
}
