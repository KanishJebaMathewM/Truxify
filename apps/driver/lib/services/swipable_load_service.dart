import 'dart:async';
import '../models/swipable_load_model.dart';

class SwipableLoadService {
  final _sessionController = StreamController<SwipableSession>.broadcast();
  
  List<FreightLoad> _pending = [];
  List<FreightLoad> _accepted = [];
  List<FreightLoad> _rejected = [];

  Stream<SwipableSession> get loadStream => _sessionController.stream;

  void fetchLoads() async {
    _pending = [
      FreightLoad(loadId: 'LD-9921', origin: 'Dallas, TX', destination: 'Chicago, IL', miles: 925, payout: 2150.0, ratePerMile: 2.32, equipmentType: '53ft Dry Van', weightLbs: '42,000'),
      FreightLoad(loadId: 'LD-8834', origin: 'Houston, TX', destination: 'Atlanta, GA', miles: 790, payout: 1400.0, ratePerMile: 1.77, equipmentType: '53ft Dry Van', weightLbs: '15,000'),
      FreightLoad(loadId: 'LD-7711', origin: 'Austin, TX', destination: 'Denver, CO', miles: 980, payout: 3100.0, ratePerMile: 3.16, equipmentType: '53ft Flatbed', weightLbs: '48,000'),
      FreightLoad(loadId: 'LD-6652', origin: 'San Antonio, TX', destination: 'Phoenix, AZ', miles: 990, payout: 1850.0, ratePerMile: 1.86, equipmentType: '53ft Reefer', weightLbs: '35,000'),
    ];

    _updateState('Searching for Freight matching your criteria...');
  }

  void swipeRight(FreightLoad load) {
    _pending.removeWhere((l) => l.loadId == load.loadId);
    _accepted.add(load);
    _updateState('Load ${load.loadId} Booked Successfully!');
  }

  void swipeLeft(FreightLoad load) {
    _pending.removeWhere((l) => l.loadId == load.loadId);
    _rejected.add(load);
    _updateState('Load Passed.');
  }
  
  void _updateState(String status) {
    _sessionController.add(SwipableSession(
      status: status,
      pendingLoads: List.from(_pending),
      acceptedLoads: List.from(_accepted),
      rejectedLoads: List.from(_rejected),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
