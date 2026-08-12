class JawsStatus {
  final bool isLeftJawLocked;
  final bool isRightJawLocked;
  final bool isReleaseHandleSecured;

  JawsStatus({
    required this.isLeftJawLocked,
    required this.isRightJawLocked,
    required this.isReleaseHandleSecured,
  });

  bool get isFullyLocked => isLeftJawLocked && isRightJawLocked && isReleaseHandleSecured;
}

class KingpinSession {
  final String status; // "Awaiting Trailer Connection", "Performing Autonomous Tug Test", "SECURED"
  final bool isTugTestActive;
  final bool isTransmissionLocked;
  final String? blockchainVerificationHash;
  final JawsStatus jaws;

  KingpinSession({
    required this.status,
    required this.isTugTestActive,
    required this.isTransmissionLocked,
    this.blockchainVerificationHash,
    required this.jaws,
  });
}
