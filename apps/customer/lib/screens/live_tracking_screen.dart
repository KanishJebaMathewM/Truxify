import 'dart:async';
import 'dart:convert';
import '../core/api_client.dart';
import '../services/order_service.dart';
import '../services/tracking_service.dart';
import '../services/voice_ai_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:latlong2/latlong.dart';
import 'package:share_plus/share_plus.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:url_launcher/url_launcher.dart';
import '../core/offline/websocket/resilient_websocket.dart';
import '../theme/app_theme.dart';
import '../constants/supabase_config.dart';
import '../widgets/common_widgets.dart';
import '../widgets/timeline_connector.dart';
import '../widgets/timeline_milestone.dart';

class LiveTrackingScreen extends StatefulWidget {
  const LiveTrackingScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<LiveTrackingScreen> createState() => _LiveTrackingScreenState();
}

class _LiveTrackingScreenState extends State<LiveTrackingScreen>
    with SingleTickerProviderStateMixin {
  late final AnimationController _movementController;
  late final OrderService _orderService;
  late final TrackingService _trackingService;
  List<Map<String, dynamic>> _timeline = [];
  Map<String, dynamic>? _order;
  RealtimeChannel? _ordersChannel;
  List<LatLng> _routePoints = const [];

  static const String _loadingDriverText = 'Loading driver...';
  static const String _loadingTruckText = 'Loading truck...';
  static const String _fallbackDriverText = 'Driver not assigned';
  static const String _fallbackTruckText = 'Truck not assigned';

  String _driverName = _loadingDriverText;
  String? _driverPhone;
  String _truckNumber = _loadingTruckText;
  bool _isLoadingDetails = false;
  LatLng? _previousPosition;
  LatLng? _currentPosition;
  ResilientWebSocket? _trackingWebSocket;
  StreamSubscription? _trackingSubscription;
  RealtimeChannel? _supabaseRealtimeChannel;

  // ── Route polyline state ──────────────────────────────────────────────
  Timer? _routeRefreshTimer;
  bool _isFetchingRoute = false;
  DateTime? _lastRouteFetchAt;
  bool _isRouteLoading = false;
  static const Duration _routeRefreshInterval = Duration(seconds: 30);

  @override
  void initState() {
    super.initState();

    _orderService = OrderService();
    _trackingService = TrackingService();
    _movementController = AnimationController(
      vsync: this,
      duration: const Duration(milliseconds: 1500),
    );

    _loadOrder();
    _loadTimeline();
    _loadRoute();
    _routeRefreshTimer = Timer.periodic(
      _routeRefreshInterval,
      (_) => _loadRoute(),
    );
    if (SupabaseConfig.isConfigured) {
      _subscribeToOrderUpdates();
      _subscribeToTracking();
    } else {
      debugPrint('[LiveTracking] Supabase not configured — real-time updates disabled');
    }
  }

  @override
  void dispose() {
    _routeRefreshTimer?.cancel();
    _movementController.dispose();
    if (SupabaseConfig.isConfigured) {
      if (_ordersChannel != null) {
        Supabase.instance.client.removeChannel(_ordersChannel!);
      }
      if (_supabaseRealtimeChannel != null) {
        Supabase.instance.client.removeChannel(_supabaseRealtimeChannel!);
      }
    }
    _trackingSubscription?.cancel();
    unawaited(_trackingWebSocket?.close());
    super.dispose();
  }

  void _subscribeToTracking() {
    final apiBaseUrl = ApiClient.defaultBaseUrl;
    final baseUri = Uri.parse(apiBaseUrl);
    final wsScheme = baseUri.scheme == 'https' ? 'wss' : 'ws';
    
    var wsPath = baseUri.path;
    if (wsPath.endsWith('/')) {
      wsPath = wsPath.substring(0, wsPath.length - 1);
    }
    wsPath = '$wsPath/ws/tracking';

    String buildUrl() {
      final session = Supabase.instance.client.auth.currentSession;
      final token = session?.accessToken ?? '';
      final wsUri = Uri(
        scheme: wsScheme,
        host: baseUri.host,
        port: baseUri.hasPort ? baseUri.port : null,
        path: wsPath,
        queryParameters: token.isNotEmpty ? {'token': token} : null,
      );
      return wsUri.toString();
    }

    final initialWsUrl = buildUrl();
    final redactedUrl = initialWsUrl.replaceAll(RegExp(r'token=[^&]+'), 'token=[REDACTED]');
    debugPrint('Connecting to tracking WebSocket at: $redactedUrl');

    _trackingWebSocket = ResilientWebSocket(
      initialWsUrl,
      urlFactory: buildUrl,
      onConnect: () {
        debugPrint('WebSocket connected, subscribing to order updates...');
        _trackingWebSocket?.send({
          'event': 'subscribe_tracking',
          'data': {
            'order_display_id': widget.orderId,
          },
        });
      },
    );

    _trackingSubscription = _trackingWebSocket!.stream.listen((message) {
      debugPrint('Tracking WebSocket message received: $message');
      if (message is! String) return;
      try {
        if (message == 'pong') return;
        final payload = jsonDecode(message) as Map<String, dynamic>;

        if (payload['event'] == 'location_update') {
          final data = payload['data'] as Map<String, dynamic>?;
          if (data != null) {
            final lat = (data['latitude'] as num?)?.toDouble();
            final lng = (data['longitude'] as num?)?.toDouble();

            if (lat != null && lng != null && mounted) {
              _updateTruckPosition(LatLng(lat, lng));
            }
          }
        }
      } catch (e) {
        debugPrint('Error parsing tracking WebSocket message: $e');
      }
    });

    _trackingWebSocket!.connect();
  }

  void _updateTruckPosition(LatLng newPosition) {
    if (!mounted) return;

    if (_currentPosition == null) {
      setState(() {
        _currentPosition = newPosition;
      });
      return;
    }

    setState(() {
      if (_previousPosition != null && _movementController.isAnimating) {
        final t = _movementController.value;
        _previousPosition = LatLng(
          _previousPosition!.latitude +
              (_currentPosition!.latitude - _previousPosition!.latitude) * t,
          _previousPosition!.longitude +
              (_currentPosition!.longitude - _previousPosition!.longitude) * t,
        );
      } else {
        _previousPosition = _currentPosition;
      }
      _currentPosition = newPosition;
    });
    _movementController.forward(from: 0.0);
  }

  Future<void> _loadOrder() async {
    try {
      final order = await _orderService.fetchOrderById(widget.orderId);

      debugPrint('ORDER DATA = $order');

      if (!mounted) return;

      bool isStale = false;
      setState(() {
        if (_order != null && order != null) {
          final existingUpdated =
              DateTime.tryParse(_order?['updated_at']?.toString() ?? '');
          final newUpdated =
              DateTime.tryParse(order['updated_at']?.toString() ?? '');
          if (existingUpdated != null &&
              newUpdated != null &&
              newUpdated.isBefore(existingUpdated)) {
            isStale = true;
            return;
          }
        }

        _order = order;

        if (order != null) {
          final dn = order['driver_name']?.toString().trim();
          final tn = order['truck_number']?.toString().trim();

          if (dn != null && dn.isNotEmpty) {
            _driverName = dn;
          } else if (order['driver_id'] == null) {
            _driverName = _fallbackDriverText;
          } else {
            _driverName = _loadingDriverText;
          }
          _driverPhone = order['driver_phone']?.toString().trim();

          if (tn != null && tn.isNotEmpty) {
            _truckNumber = tn;
          } else if (order['truck_id'] == null) {
            _truckNumber = _fallbackTruckText;
          } else {
            _truckNumber = _loadingTruckText;
          }
        } else {
          _driverName = _fallbackDriverText;
          _truckNumber = _fallbackTruckText;
        }

        final pickupLat = (order?['pickup_lat'] as num?)?.toDouble();
        final pickupLng = (order?['pickup_lng'] as num?)?.toDouble();
        final dropLat = (order?['drop_lat'] as num?)?.toDouble();
        final dropLng = (order?['drop_lng'] as num?)?.toDouble();

        if (pickupLat != null &&
            pickupLng != null &&
            dropLat != null &&
            dropLng != null) {
          _routePoints = [
            LatLng(pickupLat, pickupLng),
            LatLng(dropLat, dropLng),
          ];
        }
      });

      if (isStale) return;

      if (order != null) {
        await _fetchDriverAndTruck(order['driver_id'], order['truck_id']);
        if (order['id'] != null) {
          _subscribeToSupabaseRealtime(order['id'] as String);
          _fetchInitialDriverLocation();
        }
      }
    } catch (e) {
      debugPrint('Failed to load order: $e');
    }
  }

  void _subscribeToSupabaseRealtime(String orderUuid) {
    if (_supabaseRealtimeChannel != null) {
      return;
    }

    debugPrint('Subscribing to Supabase Realtime channel driver-location:$orderUuid');

    _supabaseRealtimeChannel = Supabase.instance.client
        .channel('driver-location:$orderUuid');

    _supabaseRealtimeChannel!.onBroadcast(
      event: 'location',
      callback: (payload) {
        debugPrint('Received Supabase Realtime location update: $payload');
        final lat = (payload['lat'] as num?)?.toDouble();
        final lng = (payload['lng'] as num?)?.toDouble();
        if (lat != null && lng != null && mounted) {
          _updateTruckPosition(LatLng(lat, lng));
        }
      },
    ).subscribe((status, error) {
      if (error != null) {
        debugPrint('Supabase Realtime subscription error: $error');
      } else {
        debugPrint('Supabase Realtime subscription status: $status');
      }
    });
  }

  Future<void> _fetchInitialDriverLocation() async {
    try {
      final locData = await _orderService.fetchDriverLocation(widget.orderId);
      final data = locData['data'] ?? locData;
      final lat = (data['lat'] as num?)?.toDouble();
      final lng = (data['lng'] as num?)?.toDouble();
      if (lat != null && lng != null && mounted) {
        _updateTruckPosition(LatLng(lat, lng));
      }
    } catch (e) {
      debugPrint('Failed to fetch initial driver location: $e');
    }
  }
  Future<void> _loadRoute() async {
    if (!mounted) return;

    if (_isFetchingRoute) return;

    final lastFetch = _lastRouteFetchAt;
    if (lastFetch != null &&
        DateTime.now().difference(lastFetch) < _routeRefreshInterval) {
      return;
    }

    _isFetchingRoute = true;
    final isFirstLoad = _lastRouteFetchAt == null;
    _lastRouteFetchAt = DateTime.now();
    if (isFirstLoad && mounted) {
      setState(() => _isRouteLoading = true);
    }

    try {
      final routeData = await _orderService.fetchOrderRoute(widget.orderId);

      final geometry = routeData['geometry'] as Map<String, dynamic>?;
      final coordinates = geometry?['coordinates'] as List<dynamic>?;

      if (coordinates == null || coordinates.length < 2) {
        debugPrint('Route response missing usable coordinates, keeping current route.');
        return;
      }

      final points = <LatLng>[];
      for (final coord in coordinates) {
        if (coord is List && coord.length >= 2) {
          final lng = (coord[0] as num?)?.toDouble();
          final lat = (coord[1] as num?)?.toDouble();
          if (lat != null && lng != null) {
            points.add(LatLng(lat, lng));
          }
        }
      }

      if (points.length < 2 || !mounted) return;

      if (!_routePointsEqual(_routePoints, points)) {
        setState(() {
          _routePoints = points;
        });
      }
    } catch (e) {
      debugPrint('Failed to load route: $e');
    } finally {
      _isFetchingRoute = false;
      if (isFirstLoad && mounted) {
        setState(() => _isRouteLoading = false);
      }
    }
  }

  bool _routePointsEqual(List<LatLng> a, List<LatLng> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i++) {
      if (a[i].latitude != b[i].latitude || a[i].longitude != b[i].longitude) {
        return false;
      }
    }
    return true;
  }

  Future<void> _fetchDriverAndTruck(dynamic driverId, dynamic truckId) async {
    if (driverId == null && truckId == null) {
      if (mounted) {
        setState(() {
          _driverName = _fallbackDriverText;
          _truckNumber = _fallbackTruckText;
          _isLoadingDetails = false;
        });
      }
      return;
    }

    if (mounted) {
      setState(() {
        _isLoadingDetails = true;
      });
    }

    try {
      final results = await Future.wait<String?>([
        driverId != null
            ? _orderService.fetchDriverName(driverId.toString())
            : Future.value(null),
        truckId != null
            ? _orderService.fetchTruckNumber(truckId.toString())
            : Future.value(null),
      ]);

      if (!mounted) return;

      if (_order?['driver_id'] != driverId || _order?['truck_id'] != truckId) {
        return;
      }

      setState(() {
        final dnFallback = _order?['driver_name']?.toString().trim();
        _driverName = results[0] ??
            (dnFallback != null && dnFallback.isNotEmpty ? dnFallback : _fallbackDriverText);

        final tnFallback = _order?['truck_number']?.toString().trim();
        _truckNumber = results[1] ??
            (tnFallback != null && tnFallback.isNotEmpty ? tnFallback : _fallbackTruckText);
        _isLoadingDetails = false;
      });
    } catch (e) {
      debugPrint('Error fetching driver/truck details: $e');
      if (!mounted) return;

      if (_order?['driver_id'] != driverId || _order?['truck_id'] != truckId) {
        return;
      }

      setState(() {
        _isLoadingDetails = false;
        final dnFallback = _order?['driver_name']?.toString().trim();
        _driverName = dnFallback != null && dnFallback.isNotEmpty ? dnFallback : _fallbackDriverText;
        final tnFallback = _order?['truck_number']?.toString().trim();
        _truckNumber = tnFallback != null && tnFallback.isNotEmpty ? tnFallback : _fallbackTruckText;
      });
    }
  }

  Future<void> _showVoiceAi() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(
                  width: 46,
                  height: 5,
                  decoration: BoxDecoration(
                      color: TruxifyColors.border,
                      borderRadius: BorderRadius.circular(999))),
              const SizedBox(height: 18),
              const CircleAvatar(
                  radius: 34,
                  backgroundColor: TruxifyColors.accentLight,
                  child: Icon(Icons.mic_rounded,
                      color: TruxifyColors.accentDark, size: 34)),
              const SizedBox(height: 16),
              Text('Voice AI',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                VoiceAiService.buildResponse(VoiceAiOrderInput.fromMap(_order)),
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(
                    color: TruxifyColors.adaptiveSecondaryText(context)),
              ),
              const SizedBox(height: 20),
              const SizedBox(
                height: 56,
                child: Center(child: LiveDot(size: 14)),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showCallDriver() async {
    final phone = _driverPhone;

    if (phone == null || phone.isEmpty) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Driver contact number unavailable')),
      );
      return;
    }

    final uri = Uri.parse('tel:$phone');
    if (await canLaunchUrl(uri)) {
      await launchUrl(uri);
    } else {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Could not initiate call to $phone')),
      );
    }
  }

  Future<void> _showChangeDrop() async {
    final newDropController = TextEditingController(text: _order?['drop_address']?.toString() ?? '');
    final latController = TextEditingController(text: (_order?['drop_lat']?.toString() ?? ''));
    final lngController = TextEditingController(text: (_order?['drop_lng']?.toString() ?? ''));

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        bool isLoading = false;
        String? pricingText;

        return StatefulBuilder(builder: (context, setModalState) {
          return Padding(
            padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
            child: Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Change Drop',
                      style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                  const SizedBox(height: 14),
                  TextField(
                      controller: newDropController,
                      decoration: const InputDecoration(labelText: 'New drop location')),
                  const SizedBox(height: 8),
                  Row(children: [
                    Flexible(
                      child: TextField(
                        controller: latController,
                        keyboardType: TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Latitude'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Flexible(
                      child: TextField(
                        controller: lngController,
                        keyboardType: TextInputType.numberWithOptions(decimal: true),
                        decoration: const InputDecoration(labelText: 'Longitude'),
                      ),
                    ),
                  ]),
                  const SizedBox(height: 16),
                  InfoCard(
                    child: Row(
                      children: [
                        const Icon(Icons.attach_money_rounded, color: TruxifyColors.accentDark),
                        const SizedBox(width: 10),
                        Expanded(
                          child: Text(
                            (pricingText ?? 'New estimated price: calculating...'),
                            style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700),
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),
                  PrimaryButton(
                    label: isLoading ? 'Requesting...' : 'Request Change',
                    onPressed: isLoading
                        ? null
                        : () async {
                            final addr = newDropController.text.trim();
                            final lat = double.tryParse(latController.text.trim());
                            final lng = double.tryParse(lngController.text.trim());
                            if (addr.isEmpty || lat == null || lng == null) {
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Please enter valid address and coordinates')));
                              return;
                            }

                            setModalState(() => isLoading = true);
                            try {
                              final resp = await _orderService.changeDrop(
                                orderDisplayId: widget.orderId,
                                dropAddress: addr,
                                dropLat: lat,
                                dropLng: lng,
                              );

                              final pricing = resp['pricing'];
                              final total = pricing != null ? pricing['total_amount'] : null;
                              setModalState(() => pricingText = total != null ? 'New estimated price: ₹${total.toString()}' : 'Price updated');

                              // refresh outer order state
                              await _loadOrder();

                              if (!context.mounted) return;
                              Navigator.of(context).pop();
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Drop location updated successfully')));
                            } catch (e) {
                              setModalState(() => isLoading = false);
                              if (!context.mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to change drop: $e')));
                            }
                          },
                  ),
                ],
              ),
            ),
          );
        });
      },
    );

    newDropController.dispose();
    latController.dispose();
    lngController.dispose();
  }

  Future<void> _showCancel() async {
    bool isLoading = false;
    final rawFee = _order?['cancellation_fee'];
    final feeInRupees = rawFee != null ? (rawFee as num) / 100 : null;
    String? feeText = feeInRupees != null ? 'Cancellation fee ₹${feeInRupees.toStringAsFixed(2)}' : null;

    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return StatefulBuilder(builder: (context, setModalState) {
          return Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                const Icon(Icons.warning_amber_rounded, color: TruxifyColors.warning, size: 42),
                const SizedBox(height: 10),
                Text(feeText ?? 'Cancellation fee calculating...',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 6),
                Text('This fee is charged for cancelling after assignment.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                const SizedBox(height: 18),
                PrimaryButton(
                  label: isLoading ? 'Cancelling...' : 'Confirm Cancel',
                  backgroundColor: TruxifyColors.error,
                  onPressed: isLoading
                      ? null
                      : () async {
                          setModalState(() => isLoading = true);
                          try {
                            final resp = await _orderService.cancelOrder(orderDisplayId: widget.orderId);
                            final rawFee = resp['cancellation_fee'];
                            final feeInRupees = rawFee != null ? (rawFee as num) / 100 : 0;
                            await _loadOrder();
                            if (!context.mounted) return;
                            Navigator.of(context).pop();
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Order cancelled. Fee: ₹${feeInRupees.toStringAsFixed(2)}')));
                          } catch (e) {
                            setModalState(() => isLoading = false);
                            if (!context.mounted) return;
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Failed to cancel order: $e')));
                          }
                        },
                ),
              ],
            ),
          );
        });
      },
    );
  }

  Future<void> _shareTracking() async {
    if (_order == null) return;

    try {
      final result = await _trackingService.shareTrackingLink(
        orderDisplayId: widget.orderId,
      );

      final trackingUrl = result['trackingUrl'] as String?;
      if (trackingUrl == null || trackingUrl.isEmpty) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Failed to generate tracking link')),
        );
        return;
      }

      if (!mounted) return;
      await Share.share(
        'Track your shipment on Truxify:\n$trackingUrl',
        subject: 'Shipment Tracking - ${widget.orderId}',
      );
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Unable to share: $e')),
      );
    }
  }

  static const LatLng _fallbackPickupPoint = LatLng(21.1702, 72.8311);
  static const LatLng _fallbackDropPoint = LatLng(26.9124, 75.7873);

  Future<void> _loadTimeline() async {
    try {
      final timeline = await _orderService.fetchOrderTimeline(widget.orderId);

      if (!mounted) return;

      setState(() {
        _timeline = timeline;
      });
    } catch (e) {
      debugPrint('Failed to load order timeline: $e');
    }
  }

  void _subscribeToOrderUpdates() {
    _ordersChannel = Supabase.instance.client
        .channel('order_updates_${widget.orderId}')
        .onPostgresChanges(
          event: PostgresChangeEvent.update,
          schema: 'public',
          table: 'orders',
          filter: PostgresChangeFilter(
            type: PostgresChangeFilterType.eq,
            column: 'order_display_id',
            value: widget.orderId,
          ),
          callback: (payload) {
            debugPrint('Realtime order update: ${payload.newRecord}');
            _loadOrder();
            _loadTimeline();
          },
        )
        .subscribe();
  }

  List<Marker> _buildTruckMarkers() {
    if (_currentPosition == null) {
      return const [];
    }

    LatLng point;
    if (_previousPosition != null && _movementController.isAnimating) {
      final t = _movementController.value;
      point = LatLng(
        _previousPosition!.latitude +
            (_currentPosition!.latitude - _previousPosition!.latitude) * t,
        _previousPosition!.longitude +
            (_currentPosition!.longitude - _previousPosition!.longitude) * t,
      );
    } else {
      point = _currentPosition!;
    }

    return [
      Marker(
        point: point,
        width: 54,
        height: 54,
        child: Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: TruxifyColors.accentDark,
            border: Border.all(color: Colors.white, width: 2),
          ),
          child: const Icon(
            Icons.local_shipping_rounded,
            color: Colors.white,
            size: 26,
          ),
        ),
      ),
    ];
  }

  List<Widget> _buildTimelineWidgets() {
    if (_timeline.isEmpty) {
      return const [
        TimelineMilestone(label: 'Order Placed', done: true),
        TimelineConnector(),
        TimelineMilestone(label: 'In Transit', done: true, current: true),
        TimelineConnector(),
        TimelineMilestone(label: 'Delivered', done: false),
      ];
    }

    final widgets = <Widget>[];

    for (int i = 0; i < _timeline.length; i++) {
      final step = _timeline[i];
      final completed = step['completed'] == true;

      final isCurrent = completed &&
          (i == _timeline.length - 1 || _timeline[i + 1]['completed'] != true);

      widgets.add(
        TimelineMilestone(
          label: step['milestone']?.toString() ?? '',
          done: completed,
          current: isCurrent,
        ),
      );

      if (i != _timeline.length - 1) {
        widgets.add(const TimelineConnector());
      }
    }

    return widgets;
  }

  @override
  Widget build(BuildContext context) {
    final driverName = _driverName;
    final truckNumber = _truckNumber;
    final eta = _order?['eta']?.toString() ?? 'TBD';
    final currentLocation = _order?['status']?.toString() ?? 'Pending';
    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: FlutterMap(
              options: const MapOptions(
                initialCenter: LatLng(24.25, 74.40),
                initialZoom: 6.2,
                minZoom: 5,
                maxZoom: 16,
              ),
              children: [
                TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      tileProvider: CancellableNetworkTileProvider(),
                      userAgentPackageName: 'com.truxify.customer',
                    ),
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: _routePoints,
                          strokeWidth: 4,
                          color: TruxifyColors.accentDark,
                        ),
                      ],
                    ),
                    AnimatedBuilder(
                      animation: _movementController,
                      builder: (context, _) {
                        if (_routePoints.isEmpty) return const SizedBox.shrink();
                        return MarkerLayer(
                          markers: [
                            if (_routePoints.isNotEmpty) ...[
                              Marker(
                                point: _routePoints.first,
                                width: 30,
                                height: 30,
                                child: const Icon(Icons.trip_origin_rounded,
                                    color: Colors.blue, size: 22),
                              ),
                              Marker(
                                point: _routePoints.last,
                                width: 34,
                                height: 34,
                                child: const Icon(Icons.place_rounded,
                                    color: Colors.redAccent, size: 26),
                              ),
                            ],
                            ..._buildTruckMarkers(),
                          ],
                        );
                      }
                    ),
                  ],
                );
            ),
          ),
          Positioned(
            top: 0,
            left: 0,
            right: 0,
            child: SafeArea(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                child: Row(
                  children: [
                    Container(
                      decoration: BoxDecoration(
                        color: Theme.of(context).colorScheme.surface,
                        shape: BoxShape.circle,
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withValues(alpha: 0.12),
                            blurRadius: 8,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: IconButton(
                        onPressed: () => Navigator.of(context).pop(),
                        icon: Icon(
                          Icons.arrow_back_rounded,
                          color: Theme.of(context).brightness == Brightness.dark
                              ? TruxifyColors.darkPrimaryText
                              : TruxifyColors.accentDark,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 16, vertical: 8),
                        decoration: BoxDecoration(
                          color: Theme.of(context).colorScheme.surface,
                          borderRadius: BorderRadius.circular(28),
                          boxShadow: [
                            BoxShadow(
                              color: Colors.black.withValues(alpha: 0.12),
                              blurRadius: 8,
                              offset: const Offset(0, 3),
                            ),
                          ],
                        ),
                        child: Row(
                          children: [
                            Expanded(
                              child: Column(
                                mainAxisSize: MainAxisSize.min,
                                crossAxisAlignment: CrossAxisAlignment.start,
                                children: [
                                  Text(
                                    widget.orderId,
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleMedium
                                        ?.copyWith(
                                          fontWeight: FontWeight.w800,
                                        ),
                                  ),
                                  const SizedBox(height: 2),
                                  Row(
                                    children: [
                                      if (_isRouteLoading) ...[
                                        const SizedBox(
                                          width: 10,
                                          height: 10,
                                          child: CircularProgressIndicator(
                                            strokeWidth: 1.5,
                                            color: TruxifyColors.accent,
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          'Loading route...',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: TruxifyColors.accent,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ] else ...[
                                        const LiveDot(
                                          color: TruxifyColors.accent,
                                          size: 8,
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          'Live',
                                          style: TextStyle(
                                            fontSize: 12,
                                            color: TruxifyColors.accent,
                                            fontWeight: FontWeight.w700,
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              onPressed: _order == null ? null : _shareTracking,
                              icon: Icon(
                                Icons.share_rounded,
                                color: Theme.of(context).brightness ==
                                        Brightness.dark
                                    ? TruxifyColors.darkPrimaryText
                                    : TruxifyColors.accentDark,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: DraggableScrollableSheet(
              initialChildSize: 0.28,
              minChildSize: 0.23,
              maxChildSize: 0.78,
              builder: (context, scrollController) {
                return Container(
                  decoration: BoxDecoration(
                    color: Theme.of(context).colorScheme.surface,
                    borderRadius:
                        const BorderRadius.vertical(top: Radius.circular(24)),
                    boxShadow: const [
                      BoxShadow(
                          color: Color(0x20000000),
                          blurRadius: 16,
                          offset: Offset(0, -2))
                    ],
                  ),
                  child: SingleChildScrollView(
                    controller: scrollController,
                    padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Center(
                          child: Container(
                            width: 46,
                            height: 5,
                            decoration: BoxDecoration(
                                color: TruxifyColors.border,
                                borderRadius: BorderRadius.circular(999)),
                          ),
                        ),
                        const SizedBox(height: 14),
                        Row(
                          children: [
                            Expanded(
                                child: Text(driverName,
                                    style: Theme.of(context)
                                        .textTheme
                                        .titleLarge
                                        ?.copyWith(
                                            fontWeight: FontWeight.w800))),
                            StatusBadge(
                                label: 'Live',
                                color: TruxifyColors.accentDark,
                                filled: true),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(truckNumber,
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                    color: TruxifyColors.adaptiveSecondaryText(
                                        context))),
                        const SizedBox(height: 6),
                        Text('ETA: $eta',
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        Text('Current location: $currentLocation',
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(
                                    color: TruxifyColors.adaptiveSecondaryText(
                                        context))),
                        const SizedBox(height: 18),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: _buildTimelineWidgets(),
                          ),
                        ),
                        const SizedBox(height: 18),
                        GridView.count(
                          crossAxisCount: 2,
                          shrinkWrap: true,
                          physics: const NeverScrollableScrollPhysics(),
                          childAspectRatio: 1.9,
                          crossAxisSpacing: 10,
                          mainAxisSpacing: 10,
                          children: [
                            _ActionTile(
                                icon: Icons.mic_rounded,
                                label: 'Voice AI',
                                onTap: _order == null ? null : _showVoiceAi),
                            _ActionTile(
                                icon: Icons.call_rounded,
                                label: 'Call Driver',
                                onTap: _order == null ? null : _showCallDriver),
                            _ActionTile(
                                icon: Icons.edit_location_alt_rounded,
                                label: 'Change Drop',
                                onTap: _order == null ? null : _showChangeDrop),
                            _ActionTile(
                                icon: Icons.close_rounded,
                                label: 'Cancel',
                                color: TruxifyColors.error,
                                onTap: _order == null ? null : _showCancel),
                          ],
                        ),
                      ],
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile(
      {required this.icon,
      required this.label,
      this.onTap,
      this.color = TruxifyColors.accentDark});

  final IconData icon;
  final String label;
  final VoidCallback? onTap;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onTap,
      style: OutlinedButton.styleFrom(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 14),
        minimumSize: const Size(0, 0),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: onTap == null ? TruxifyColors.border : color),
          const SizedBox(height: 6),
          Text(
            label,
            textAlign: TextAlign.center,
            style: onTap == null ? const TextStyle(color: TruxifyColors.border) : null,
          ),
        ],
      ),
    );
  }
}