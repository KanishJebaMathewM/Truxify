import 'dart:async';
import '../models/border_clearance_model.dart';

class BorderClearanceService {
  final _sessionController = StreamController<BorderClearanceSession>.broadcast();

  Stream<BorderClearanceSession> get clearanceStream => _sessionController.stream;

  void simulateBorderCrossing() async {
    // 1. Approaching
    _sessionController.add(BorderClearanceSession(
      status: 'Approaching Port of Entry...',
      crossingName: 'Ambassador Bridge (US/Canada)',
      distanceToBorderMiles: 2.5,
      isCleared: false,
      bondedFeesUsd: 145.50,
      payloads: [
        CryptographicPayload(documentType: 'Digital Passport', status: 'Staged', hash: '...'),
        CryptographicPayload(documentType: 'Electronic Bill of Lading', status: 'Staged', hash: '...'),
        CryptographicPayload(documentType: 'Customs Bond Smart Contract', status: 'Staged', hash: '...'),
      ],
    ));

    await Future.delayed(const Duration(seconds: 3));

    // 2. Transmitting ZKP
    _sessionController.add(BorderClearanceSession(
      status: 'TRANSMITTING ZERO-KNOWLEDGE PROOF...',
      crossingName: 'Ambassador Bridge (US/Canada)',
      distanceToBorderMiles: 0.5,
      isCleared: false,
      bondedFeesUsd: 145.50,
      payloads: [
        CryptographicPayload(documentType: 'Digital Passport', status: 'Transmitting...', hash: '0x9a8b...'),
        CryptographicPayload(documentType: 'Electronic Bill of Lading', status: 'Transmitting...', hash: '0x1c2d...'),
        CryptographicPayload(documentType: 'Customs Bond Smart Contract', status: 'Transmitting...', hash: '0x3e4f...'),
      ],
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Cleared
    _sessionController.add(BorderClearanceSession(
      status: 'CLEARANCE GRANTED: PROCEED WITHOUT STOPPING',
      crossingName: 'Ambassador Bridge (US/Canada)',
      distanceToBorderMiles: 0.0,
      isCleared: true,
      bondedFeesUsd: 145.50, // Funds locked/transferred
      payloads: [
        CryptographicPayload(documentType: 'Digital Passport', status: 'Verified', hash: '0x9a8b7c6d5e4f'),
        CryptographicPayload(documentType: 'Electronic Bill of Lading', status: 'Verified', hash: '0x1c2d3e4f5a6b'),
        CryptographicPayload(documentType: 'Customs Bond Smart Contract', status: 'Executed', hash: '0x3e4f5a6b7c8d'),
      ],
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
