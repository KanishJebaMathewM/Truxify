import 'dart:async';
import 'dart:isolate';
import 'location_mapper.dart';

/// Worker entry point running on separate background Isolate thread
void isolateWorkerEntryPoint(SendPort mainSendPort) {
  final isolateReceivePort = ReceivePort();
  mainSendPort.send(isolateReceivePort.sendPort);

  isolateReceivePort.listen((message) {
    if (message is Map<String, dynamic>) {
      final formatted = LocationMapper.formatTelemetryPayload(
        driverId: message['driverId'] ?? '',
        orderId: message['orderId'] ?? '',
        lat: message['lat'] ?? 0.0,
        lng: message['lng'] ?? 0.0,
        speed: message['speed'] ?? 0.0,
        bearing: message['bearing'] ?? 0.0,
      );

      // Processed on background thread, sent back to main UI thread
      mainSendPort.send(formatted);
    }
  });
}
