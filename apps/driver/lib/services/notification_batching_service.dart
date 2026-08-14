import 'dart:async';
import '../models/notification_batching_model.dart';

class NotificationBatchingService {
  final _sessionController = StreamController<NotificationBatchingSession>.broadcast();
  
  double _speed = 65.0; // Starts driving
  final List<ContextNotification> _delivered = [];
  final List<ContextNotification> _queue = [];
  Timer? _simTimer;
  int _tick = 0;

  Stream<NotificationBatchingSession> get notificationStream => _sessionController.stream;

  void startSimulation() {
    _emitState();
    _simTimer = Timer.periodic(const Duration(seconds: 3), (timer) {
      _tick++;
      if (_tick == 1) {
        _handleIncomingNotification(
          title: 'Company Newsletter',
          message: 'Check out our driver of the month!',
          isUrgent: false,
        );
      } else if (_tick == 2) {
        _handleIncomingNotification(
          title: 'URGENT: Load Cancelled',
          message: 'Do NOT proceed to pickup. Contact dispatch.',
          isUrgent: true,
        );
      } else if (_tick == 3) {
        _handleIncomingNotification(
          title: 'Safety Tip',
          message: 'Remember to check tire pressure in winter.',
          isUrgent: false,
        );
      } else if (_tick == 4) {
        // Driver stops
        _speed = 0.0;
        _flushQueue();
      } else if (_tick > 5) {
        timer.cancel();
      }
      _emitState();
    });
  }

  void _handleIncomingNotification({required String title, required String message, required bool isUrgent}) {
    final notif = ContextNotification(
      id: DateTime.now().millisecondsSinceEpoch.toString(),
      title: title,
      message: message,
      isUrgent: isUrgent,
      timestamp: DateTime.now(),
    );

    if (isUrgent || _speed == 0.0) {
      _delivered.insert(0, notif);
    } else {
      _queue.add(notif);
    }
  }

  void _flushQueue() {
    for (var n in _queue) {
      _delivered.insert(0, n);
    }
    _queue.clear();
  }

  void toggleSpeed(double newSpeed) {
    _speed = newSpeed;
    if (_speed == 0.0) {
      _flushQueue();
    }
    _emitState();
  }

  void _emitState() {
    _sessionController.add(NotificationBatchingSession(
      currentSpeedMph: _speed,
      deliveredNotifications: List.from(_delivered),
      batchedQueue: List.from(_queue),
    ));
  }

  void dispose() {
    _simTimer?.cancel();
    _sessionController.close();
  }
}
