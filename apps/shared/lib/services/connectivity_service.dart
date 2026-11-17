import 'dart:async';
import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';

/// Service that monitors device network connectivity state using connectivity_plus.
///
/// Dispatches real-time state changes, triggers reconnect hooks to flush offline
/// queues and buffers, and exposes reactive streams for UI banners.
class ConnectivityService {
  static ConnectivityService? _instance;

  static ConnectivityService get instance {
    _instance ??= ConnectivityService._internal();
    return _instance!;
  }

  final Connectivity _connectivity;
  StreamSubscription<List<ConnectivityResult>>? _subscription;
  final StreamController<bool> _statusController = StreamController<bool>.broadcast();
  final List<Future<void> Function()> _reconnectListeners = [];

  bool _isOnline = true;
  bool _hasInitialized = false;

  /// Creates a singleton instance.
  ConnectivityService._internal() : _connectivity = Connectivity() {
    _init();
  }

  /// Creates an isolated instance for unit and widget testing.
  @visibleForTesting
  ConnectivityService.forTesting({Connectivity? connectivity, bool initialOnline = true})
      : _connectivity = connectivity ?? Connectivity(),
        _isOnline = initialOnline {
    _init();
  }

  /// True if device currently has active network connectivity.
  bool get isOnline => _isOnline;

  /// True if device currently has no active network connectivity.
  bool get isOffline => !_isOnline;

  /// Broadcast stream emitting true when online and false when offline.
  Stream<bool> get onConnectivityChanged => _statusController.stream;

  void _init() {
    if (_hasInitialized) return;
    _hasInitialized = true;
    checkConnectivity();
    _subscription = _connectivity.onConnectivityChanged.listen(_handleConnectivityUpdate);
  }

  /// Checks current connectivity state and returns whether online.
  Future<bool> checkConnectivity() async {
    try {
      final results = await _connectivity.checkConnectivity();
      _handleConnectivityUpdate(results);
      return _isOnline;
    } catch (e) {
      debugPrint('[ConnectivityService] Error checking connectivity: $e');
      return _isOnline;
    }
  }

  void _handleConnectivityUpdate(List<ConnectivityResult> results) {
    final hasConnection = results.isNotEmpty &&
        !results.every((result) => result == ConnectivityResult.none);

    final wasOffline = !_isOnline;
    _isOnline = hasConnection;
    _statusController.add(_isOnline);

    if (wasOffline && _isOnline) {
      debugPrint('[ConnectivityService] Network reconnected. Triggering sync hooks...');
      _triggerReconnectListeners();
    }
  }

  /// Registers a callback to be executed whenever network connectivity is restored.
  void addReconnectListener(Future<void> Function() listener) {
    if (!_reconnectListeners.contains(listener)) {
      _reconnectListeners.add(listener);
    }
  }

  /// Removes a previously registered reconnect callback.
  void removeReconnectListener(Future<void> Function() listener) {
    _reconnectListeners.remove(listener);
  }

  Future<void> _triggerReconnectListeners() async {
    for (final listener in List<Future<void> Function()>.from(_reconnectListeners)) {
      try {
        await listener();
      } catch (e) {
        debugPrint('[ConnectivityService] Error in reconnect listener: $e');
      }
    }
  }

  /// Manually override connectivity state for testing or debug simulations.
  @visibleForTesting
  void setOnlineForTesting(bool online) {
    final wasOffline = !_isOnline;
    _isOnline = online;
    _statusController.add(_isOnline);
    if (wasOffline && _isOnline) {
      _triggerReconnectListeners();
    }
  }

  /// Disposes active subscriptions and stream controllers.
  void dispose() {
    _subscription?.cancel();
    _subscription = null;
    _reconnectListeners.clear();
    _statusController.close();
    _hasInitialized = false;
  }
}

/// Persistent banner displayed across customer and driver apps when offline.
///
/// Informs the user that changes are queued locally and will sync upon reconnection.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({
    super.key,
    this.message = "You're offline — changes will sync when reconnected",
    this.connectivityService,
    this.customIsOffline,
  });

  final String message;
  final ConnectivityService? connectivityService;
  final bool? customIsOffline;

  @override
  Widget build(BuildContext context) {
    final service = connectivityService ?? ConnectivityService.instance;

    if (customIsOffline != null) {
      return _buildBanner(context, customIsOffline!);
    }

    return StreamBuilder<bool>(
      stream: service.onConnectivityChanged,
      initialData: service.isOnline,
      builder: (context, snapshot) {
        final isOffline = !(snapshot.data ?? true);
        return _buildBanner(context, isOffline);
      },
    );
  }

  Widget _buildBanner(BuildContext context, bool isOffline) {
    return AnimatedCrossFade(
      firstChild: const SizedBox(width: double.infinity, height: 0),
      secondChild: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        decoration: BoxDecoration(
          color: const Color(0xFFE65100), // Dark warning amber
          boxShadow: [
            BoxShadow(
              color: Colors.black.withOpacity(0.18),
              offset: const Offset(0, 2),
              blurRadius: 4,
            ),
          ],
        ),
        child: SafeArea(
          bottom: false,
          top: false,
          child: Row(
            children: [
              const Icon(
                Icons.wifi_off_rounded,
                color: Colors.white,
                size: 20,
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  message,
                  style: const TextStyle(
                    color: Colors.white,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: 0.1,
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
      crossFadeState: isOffline ? CrossFadeState.showSecond : CrossFadeState.showFirst,
      duration: const Duration(milliseconds: 280),
    );
  }
}

/// Convenience layout wrapper that places an [OfflineBanner] directly above [child].
class OfflineBannerWrapper extends StatelessWidget {
  const OfflineBannerWrapper({
    super.key,
    required this.child,
    this.connectivityService,
  });

  final Widget child;
  final ConnectivityService? connectivityService;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        OfflineBanner(connectivityService: connectivityService),
        Expanded(child: child),
      ],
    );
  }
}
