class YardTrailer {
  final String trailerId;
  final String status; // 'Empty', 'Loaded', 'Maintenance'
  String location; // 'Spot A1', 'Dock 4'

  YardTrailer({
    required this.trailerId,
    required this.status,
    required this.location,
  });
}

class YardInstruction {
  final String instructionId;
  final String trailerId;
  final String targetLocation;
  final DateTime issuedAt;
  bool isCompleted;

  YardInstruction({
    required this.instructionId,
    required this.trailerId,
    required this.targetLocation,
    required this.issuedAt,
    this.isCompleted = false,
  });
}

class YardManagementSession {
  final String status;
  final List<YardTrailer> trailers;
  final List<YardInstruction> activeInstructions;
  final bool isSyncing;

  YardManagementSession({
    required this.status,
    required this.trailers,
    required this.activeInstructions,
    required this.isSyncing,
  });
}
