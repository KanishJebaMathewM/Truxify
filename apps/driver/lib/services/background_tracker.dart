import 'dart:async';
import 'dart:isolate';
import 'isolate_handler.dart';

/// Flutter Background Isolate Engine Thread Pool Service
class BackgroundTrackerService {
  Isolate? _isolate;
  SendPort? _workerSendPort;
  StreamSubscription<dynamic>? _receiveSubscription;
  ReceivePort? _mainReceivePort;
  StreamController<Map<String, dynamic>>? _locationController;

  Stream<Map<String, dynamic>> get locationStream {
    _locationController ??=
        StreamController<Map<String, dynamic>>.broadcast();
    return _locationController!.stream;
  }

  Future<void> startBackgroundTracking() async {
    if (_isolate != null) return;

    _mainReceivePort = ReceivePort();
    _locationController ??=
        StreamController<Map<String, dynamic>>.broadcast();

    _isolate = await Isolate.spawn(isolateWorkerEntryPoint, _mainReceivePort!.sendPort);

    _receiveSubscription = _mainReceivePort!.listen((message) {
      if (message is SendPort) {
        _workerSendPort = message;
      } else if (message is Map<String, dynamic>) {
        _locationController!.add(message);
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
    _receiveSubscription?.cancel();
    _receiveSubscription = null;
    _mainReceivePort?.close();
    _mainReceivePort = null;
    _locationController?.close();
    _locationController = null;
  }
}
