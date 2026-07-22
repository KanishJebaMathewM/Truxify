import 'dart:async';
import 'package:battery_plus/battery_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:url_launcher/url_launcher.dart';

class BatteryInfo {
  const BatteryInfo({
    required this.level,
    required this.isCharging,
  });

  final int level;
  final bool isCharging;

  bool get isLow => level <= 20;
  bool get isCritical => level <= 10;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is BatteryInfo &&
          runtimeType == other.runtimeType &&
          level == other.level &&
          isCharging == other.isCharging;

  @override
  int get hashCode => Object.hash(level, isCharging);
}

class BatteryService extends ChangeNotifier {
  BatteryService._privateConstructor();
  static final BatteryService instance = BatteryService._privateConstructor();

  final Battery _battery = Battery();
  StreamSubscription<BatteryState>? _subscription;
  Timer? _pollTimer;
  bool _isMonitoring = false;

  BatteryInfo _currentInfo = const BatteryInfo(level: 100, isCharging: false);
  BatteryInfo get currentInfo => _currentInfo;

  int get batteryLevel => _currentInfo.level;
  bool get isCharging => _currentInfo.isCharging;
  bool get isLow => _currentInfo.isLow;
  bool get isCritical => _currentInfo.isCritical;
  bool get isMonitoring => _isMonitoring;

  static const Duration _pollInterval = Duration(seconds: 60);

  Future<void> startMonitoring() async {
    if (_isMonitoring) return;
    _isMonitoring = true;

    await _fetchBatteryState();
    _listenToBatteryStateChanges();
    _startPolling();
    debugPrint('[BatteryService] Monitoring started');
  }

  void stopMonitoring() {
    _isMonitoring = false;
    _subscription?.cancel();
    _subscription = null;
    _pollTimer?.cancel();
    _pollTimer = null;
    debugPrint('[BatteryService] Monitoring stopped');
  }

  void _listenToBatteryStateChanges() {
    _subscription?.cancel();
    try {
      _subscription = _battery.onBatteryStateChanged.listen(
        (_) => _fetchBatteryState(),
        onError: (error) {
          debugPrint('[BatteryService] Battery state stream error: $error');
        },
      );
    } catch (e) {
      debugPrint('[BatteryService] Failed to listen battery state: $e');
    }
  }

  void _startPolling() {
    _pollTimer?.cancel();
    _pollTimer = Timer.periodic(_pollInterval, (_) => _fetchBatteryState());
  }

  Future<void> _fetchBatteryState() async {
    try {
      final level = await _battery.batteryLevel;
      final state = await _battery.batteryState;

      final isCharging =
          state == BatteryState.charging || state == BatteryState.full;

      final newInfo = BatteryInfo(
        level: level,
        isCharging: isCharging,
      );

      if (newInfo != _currentInfo) {
        _currentInfo = newInfo;
        notifyListeners();
        debugPrint(
          '[BatteryService] Battery updated: ${level}% '
          '${isCharging ? "(charging)" : ""}',
        );
      }
    } catch (e) {
      debugPrint('[BatteryService] Error fetching battery state: $e');
    }
  }

  Future<void> openBatterySettings() async {
    try {
      final uri = Uri(scheme: 'package', path: 'android.settings.IGNORE_BATTERY_OPTIMIZATIONS');
      if (await canLaunchUrl(uri)) {
        await launchUrl(uri);
      }
    } catch (e) {
      debugPrint('[BatteryService] Could not open battery settings: $e');
    }
  }

  @override
  void dispose() {
    stopMonitoring();
    super.dispose();
  }
}
