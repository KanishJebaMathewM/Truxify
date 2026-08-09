import 'dart:async';
import '../models/intermodal_sync_model.dart';

class RailEdiService {
  Future<RailContainer> getContainerStatus(String containerId) async {
    await Future.delayed(const Duration(seconds: 1)); // Simulate EDI ingest delay

    final now = DateTime.now();

    return RailContainer(
      containerId: containerId,
      railCarrier: 'BNSF Railway',
      trainId: 'Z-CHILAC9-12',
      terminalName: 'Logistics Park Chicago',
      status: 'In Transit',
      originalEta: now.add(const Duration(hours: 2)),
      currentEta: now.add(const Duration(hours: 5, minutes: 45)), // Delayed by 3h 45m
      delayReason: 'Freight congestion at Galesburg switching yard.',
    );
  }
}
