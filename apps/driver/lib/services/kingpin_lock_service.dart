import 'dart:async';
import '../models/kingpin_lock_model.dart';

class KingpinLockService {
  final _sessionController = StreamController<KingpinSession>.broadcast();

  Stream<KingpinSession> get lockStream => _sessionController.stream;

  void simulateCouplingProcess() async {
    // 1. Uncoupled / Backing up
    _sessionController.add(KingpinSession(
      status: 'Awaiting Trailer Connection...',
      isTugTestActive: false,
      isTransmissionLocked: true, // Cannot drive fast
      blockchainVerificationHash: null,
      jaws: JawsStatus(isLeftJawLocked: false, isRightJawLocked: false, isReleaseHandleSecured: false),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 2. Physical impact detected, jaws closing
    _sessionController.add(KingpinSession(
      status: 'Impact Detected: Jaws Closing...',
      isTugTestActive: false,
      isTransmissionLocked: true,
      blockchainVerificationHash: null,
      jaws: JawsStatus(isLeftJawLocked: true, isRightJawLocked: true, isReleaseHandleSecured: true),
    ));
    
    await Future.delayed(const Duration(seconds: 3));

    // 3. Automated Tug Test
    _sessionController.add(KingpinSession(
      status: 'PERFORMING AUTONOMOUS TUG TEST...',
      isTugTestActive: true,
      isTransmissionLocked: true,
      blockchainVerificationHash: null,
      jaws: JawsStatus(isLeftJawLocked: true, isRightJawLocked: true, isReleaseHandleSecured: true),
    ));

    await Future.delayed(const Duration(seconds: 4));

    // 4. Secure & Verified
    _sessionController.add(KingpinSession(
      status: 'CONNECTION SECURED & VERIFIED',
      isTugTestActive: false,
      isTransmissionLocked: false, // Transmission unlocked
      blockchainVerificationHash: '0x9a8f4c2e...b7d1', // Logged
      jaws: JawsStatus(isLeftJawLocked: true, isRightJawLocked: true, isReleaseHandleSecured: true),
    ));
  }

  void dispose() {
    _sessionController.close();
  }
}
