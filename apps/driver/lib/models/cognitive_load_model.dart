class QueuedNotification {
  final String id;
  final String source; // "Dispatch", "Telematics"
  final String title;
  final String priority; // "Low", "Medium"

  QueuedNotification({
    required this.id,
    required this.source,
    required this.title,
    required this.priority,
  });
}

class CognitiveLoadSession {
  final String status; // "Monitoring Conditions...", "HIGH STRESS - SILENCING ACTIVE"
  final bool isHighStressActive;
  final String trafficDensity; // "Low", "Heavy"
  final String weatherCondition; // "Clear", "Heavy Rain"
  final int suppressedCount;
  final List<QueuedNotification> queuedItems;

  CognitiveLoadSession({
    required this.status,
    required this.isHighStressActive,
    required this.trafficDensity,
    required this.weatherCondition,
    required this.suppressedCount,
    required this.queuedItems,
  });
}
