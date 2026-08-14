class DispatchCursor {
  final String userId;
  final String userName;
  final String colorHex;
  final double xOffset;
  final double yOffset;

  DispatchCursor({
    required this.userId,
    required this.userName,
    required this.colorHex,
    required this.xOffset,
    required this.yOffset,
  });
}

class DispatchLoadItem {
  final String loadId;
  final String origin;
  final String destination;
  final String? lockedByUserId;
  final String? lockedByUserName;
  final String? lockedColorHex;

  DispatchLoadItem({
    required this.loadId,
    required this.origin,
    required this.destination,
    this.lockedByUserId,
    this.lockedByUserName,
    this.lockedColorHex,
  });
  
  bool get isLocked => lockedByUserId != null;
}

class CollaborativeDispatchSession {
  final String status;
  final List<DispatchCursor> activeCursors;
  final List<DispatchLoadItem> availableLoads;

  CollaborativeDispatchSession({
    required this.status,
    required this.activeCursors,
    required this.availableLoads,
  });
}
