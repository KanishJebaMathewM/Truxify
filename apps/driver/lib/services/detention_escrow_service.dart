import 'dart:async';
import '../models/detention_escrow_model.dart';

class DetentionEscrowService {
  final _sessionController = StreamController<DetentionEscrowSession>.broadcast();
  Timer? _dwellTimer;
  int _minutesPassed = 115; // Start near the end of the 2 hour grace period

  Stream<DetentionEscrowSession> get escrowStream => _sessionController.stream;

  void simulateDetention() {
    final arrival = DateTime.now().subtract(Duration(minutes: _minutesPassed));

    _dwellTimer = Timer.periodic(const Duration(seconds: 2), (timer) {
      _minutesPassed += 2; // Fast forward time by 2 minutes every tick

      bool isDetention = _minutesPassed > 120; // 2 hour grace period
      double accrued = 0.0;
      
      if (isDetention) {
        int detentionMins = _minutesPassed - 120;
        accrued = (detentionMins / 60.0) * 50.0; // $50/hr
      }

      _sessionController.add(DetentionEscrowSession(
        facilityName: 'Amazon FC - Dallas, TX',
        facilityGeofenceId: 'GEO-AMZ-DFW9',
        status: isDetention ? 'DETENTION ACTIVE - DRAINING ESCROW' : 'Grace Period - Unloading',
        arrivalTime: arrival,
        gracePeriodMinutes: 120,
        currentDwellMinutes: _minutesPassed,
        detentionRatePerHour: 50.0,
        accumulatedDetentionPay: accrued,
        smartContractHash: '0x992B...4A1F',
      ));
      
      if (_minutesPassed >= 140) { // Stop after $16+ is accrued
        timer.cancel();
      }
    });
  }

  void dispose() {
    _dwellTimer?.cancel();
    _sessionController.close();
  }
}
