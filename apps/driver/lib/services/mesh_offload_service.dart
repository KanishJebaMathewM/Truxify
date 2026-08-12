import 'dart:async';
import '../models/mesh_offload_model.dart';

class MeshOffloadService {
  final _sessionController = StreamController<MeshSession>.broadcast();

  Stream<MeshSession> get meshStream => _sessionController.stream;

  void simulateMeshOffload() async {
    final queue = [
      OffloadData(dataType: 'Dashcam Video (4K) - Last 8 Hrs', sizeMb: 4250.0, isUploaded: false),
      OffloadData(dataType: 'ECM Telemetry Logs', sizeMb: 120.5, isUploaded: false),
      OffloadData(dataType: 'Driver HOS Logs', sizeMb: 15.2, isUploaded: false),
    ];

    // 1. On Cellular (Holding)
    _sessionController.add(MeshSession(
      status: 'On Cellular (5G). Holding large files.',
      isConnectedToMesh: false,
      networkName: null,
      uploadSpeedMbps: 0.0,
      cellularDataSavedMb: 0.0,
      dataQueue: List.from(queue),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Connecting to Mesh
    _sessionController.add(MeshSession(
      status: 'Establishing Peer-to-Peer Mesh Connection...',
      isConnectedToMesh: true,
      networkName: 'Truxify Mesh (Truck #4922)', // Connected to another truck nearby
      uploadSpeedMbps: 0.0,
      cellularDataSavedMb: 0.0,
      dataQueue: List.from(queue),
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Uploading
    _sessionController.add(MeshSession(
      status: 'BULK UPLOADING VIA MESH NETWORK',
      isConnectedToMesh: true,
      networkName: 'Truxify Mesh (Truck #4922)',
      uploadSpeedMbps: 145.5,
      cellularDataSavedMb: 2100.0, // Mid-upload
      dataQueue: [
        OffloadData(dataType: 'Dashcam Video (4K) - Last 8 Hrs', sizeMb: 4250.0, isUploaded: false), // In progress
        OffloadData(dataType: 'ECM Telemetry Logs', sizeMb: 120.5, isUploaded: true),
        OffloadData(dataType: 'Driver HOS Logs', sizeMb: 15.2, isUploaded: true),
      ],
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 4. Complete
    _sessionController.add(MeshSession(
      status: 'OFFLOAD COMPLETE. QUEUE CLEARED.',
      isConnectedToMesh: true,
      networkName: 'Truxify Mesh (Truck #4922)',
      uploadSpeedMbps: 0.0,
      cellularDataSavedMb: 4385.7,
      dataQueue: [
        OffloadData(dataType: 'Dashcam Video (4K) - Last 8 Hrs', sizeMb: 4250.0, isUploaded: true),
        OffloadData(dataType: 'ECM Telemetry Logs', sizeMb: 120.5, isUploaded: true),
        OffloadData(dataType: 'Driver HOS Logs', sizeMb: 15.2, isUploaded: true),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
