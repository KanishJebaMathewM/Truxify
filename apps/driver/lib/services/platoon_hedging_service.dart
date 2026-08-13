import 'dart:async';
import '../models/platoon_hedging_model.dart';

class PlatoonHedgingService {
  final _sessionController = StreamController<PlatoonHedgingSession>.broadcast();
  Timer? _billingTimer;
  double _myEarnings = 0.0;
  double _follower1Stream = 0.0;
  double _follower2Stream = 0.0;

  Stream<PlatoonHedgingSession> get hedgingStream => _sessionController.stream;

  void simulatePlatoonSession() async {
    // 1. Searching
    _sessionController.add(PlatoonHedgingSession(
      status: 'Awaiting Nearby Compatible Trucks...',
      isPlatooning: false,
      smartContractAddress: null,
      currentSpeedMph: 65.0,
      myNetEarningsUsd: 0.0,
      members: [],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Found peers, forming contract (We are the Leader)
    _sessionController.add(PlatoonHedgingSession(
      status: 'FORMING SMART CONTRACT...',
      isPlatooning: false,
      smartContractAddress: '0xDrafting...A92B',
      currentSpeedMph: 65.0,
      myNetEarningsUsd: 0.0,
      members: [],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Platooning Active, streaming payments
    _billingTimer = Timer.periodic(const Duration(milliseconds: 500), (timer) {
      _follower1Stream += 0.02; // Follower 1 pays 2 cents
      _follower2Stream += 0.02; // Follower 2 pays 2 cents
      _myEarnings = _follower1Stream + _follower2Stream; // We are leading, we collect

      _sessionController.add(PlatoonHedgingSession(
        status: 'AERODYNAMIC PLATOON ACTIVE',
        isPlatooning: true,
        smartContractAddress: '0xDrafting...A92B',
        currentSpeedMph: 65.0,
        myNetEarningsUsd: _myEarnings,
        members: [
          PlatoonMember(truckId: 'MY-TRUCK (LEADER)', role: 'Windbreaker', distanceFeet: 0.0, aerodynamicSavingsPercent: -2.0, activeStreamUsd: _myEarnings), // Burning extra fuel
          PlatoonMember(truckId: 'TRK-B29', role: 'Follower 1', distanceFeet: 40.0, aerodynamicSavingsPercent: 10.0, activeStreamUsd: -_follower1Stream), // Saving 10%
          PlatoonMember(truckId: 'TRK-C77', role: 'Follower 2', distanceFeet: 80.0, aerodynamicSavingsPercent: 12.0, activeStreamUsd: -_follower2Stream), // Saving 12%
        ],
      ));
    });
  }

  void dispose() {
    _billingTimer?.cancel();
    _sessionController.close();
  }
}
