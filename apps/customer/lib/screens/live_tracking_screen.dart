import 'dart:async';
import '../services/order_service.dart';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:latlong2/latlong.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../theme/app_theme.dart';
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
  late final AnimationController _truckController;
  late final OrderService _orderService;
  List<Map<String, dynamic>> _timeline = [];
  Map<String, dynamic>? _order;
  RealtimeChannel? _ordersChannel;
  List<LatLng> _routePoints = const [_fallbackPickupPoint, _fallbackDropPoint];
  String _driverName = 'Loading driver...';
  String _truckNumber = 'Loading truck...';
  bool _isLoadingDetails = false;

  @override
  void initState() {
    super.initState();

    _orderService = OrderService();
    _truckController =
        AnimationController(vsync: this, duration: const Duration(seconds: 9))
          ..repeat();

    _loadOrder();
    _loadTimeline();
    _subscribeToOrderUpdates();
  }

  @override
  void dispose() {
    _truckController.dispose();
    _ordersChannel?.unsubscribe();
    super.dispose();
  }

  Future<void> _loadOrder() async {
    try {
      final order = await _orderService.fetchOrderById(widget.orderId);

      debugPrint('ORDER DATA = $order');

      if (!mounted) return;

      setState(() {
        _order = order;

        if (order != null) {
          final dn = order['driver_name']?.toString();
          final tn = order['truck_number']?.toString();

          if (dn != null && dn.isNotEmpty) {
            _driverName = dn;
          } else if (order['driver_id'] == null) {
            _driverName = 'Driver not assigned';
          } else {
            _driverName = 'Loading driver...';
          }

          if (tn != null && tn.isNotEmpty) {
            _truckNumber = tn;
          } else if (order['truck_id'] == null) {
            _truckNumber = 'Truck not assigned';
          } else {
            _truckNumber = 'Loading truck...';
          }
        } else {
          _driverName = 'Driver not assigned';
          _truckNumber = 'Truck not assigned';
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

      if (order != null) {
        await _fetchDriverAndTruck(order['driver_id'], order['truck_id']);
      }
    } catch (e) {
      debugPrint('Failed to load order: $e');
    }
  }

  Future<void> _fetchDriverAndTruck(dynamic driverId, dynamic truckId) async {
    if (driverId == null && truckId == null) {
      if (mounted) {
        setState(() {
          _driverName = 'Driver not assigned';
          _truckNumber = 'Truck not assigned';
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
      final futures = <Future>[];

      if (driverId != null) {
        futures.add(_orderService.fetchDriverName(driverId.toString()));
      } else {
        futures.add(Future.value(null));
      }

      if (truckId != null) {
        futures.add(_orderService.fetchTruckNumber(truckId.toString()));
      } else {
        futures.add(Future.value(null));
      }

      final results = await Future.wait(futures);

      if (!mounted) return;

      setState(() {
        _driverName = results[0]?.toString() ?? _order?['driver_name']?.toString() ?? 'Driver not assigned';
        _truckNumber = results[1]?.toString() ?? _order?['truck_number']?.toString() ?? 'Truck not assigned';
        _isLoadingDetails = false;
      });
    } catch (e) {
      debugPrint('Error fetching driver/truck details: $e');
      if (!mounted) return;
      setState(() {
        _isLoadingDetails = false;
        _driverName = _order?['driver_name']?.toString() ?? 'Driver not assigned';
        _truckNumber = _order?['truck_number']?.toString() ?? 'Truck not assigned';
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
                'Your truck is near Vadodara, expected by 4:30 PM today',
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
    final driverName = _driverName;
    final truckNumber = _truckNumber;

    await showModalBottomSheet<void>(
      context: context,
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
              const SizedBox(height: 8),
              const Icon(Icons.call_rounded,
                  color: TruxifyColors.accentDark, size: 42),
              const SizedBox(height: 10),
              Text(
                'Calling $driverName',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 4),
              Text(
                truckNumber,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              const SizedBox(height: 18),
              PrimaryButton(
                label: 'End Call',
                onPressed: () => Navigator.of(context).pop(),
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showChangeDrop() async {
    final newDropController = TextEditingController(text: 'Bhiwadi, Rajasthan');
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Padding(
          padding:
              EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: Theme.of(context).colorScheme.surface,
              borderRadius:
                  const BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Change Drop',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                TextField(
                    controller: newDropController,
                    decoration:
                        const InputDecoration(labelText: 'New drop location')),
                const SizedBox(height: 16),
                InfoCard(
                  child: Row(
                    children: [
                      const Icon(Icons.attach_money_rounded,
                          color: TruxifyColors.accentDark),
                      const SizedBox(width: 10),
                      Expanded(
                          child: Text('New estimated price: ₹7,120',
                              style: Theme.of(context)
                                  .textTheme
                                  .bodyLarge
                                  ?.copyWith(fontWeight: FontWeight.w700))),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                PrimaryButton(
                    label: 'Request Change',
                    onPressed: () => Navigator.of(context).pop()),
              ],
            ),
          ),
        );
      },
    );
    newDropController.dispose();
  }

  Future<void> _showCancel() async {
    await showModalBottomSheet<void>(
      context: context,
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
              const Icon(Icons.warning_amber_rounded,
                  color: TruxifyColors.warning, size: 42),
              const SizedBox(height: 10),
              Text('Cancellation fee ₹680',
                  style: Theme.of(context)
                      .textTheme
                      .titleLarge
                      ?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('This fee is charged for cancelling after assignment.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context))),
              const SizedBox(height: 18),
              PrimaryButton(
                  label: 'Confirm Cancel',
                  backgroundColor: TruxifyColors.error,
                  onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        );
      },
    );
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

  LatLng _pointAlongRoute(double t) {
    final points = _routePoints;
    if (points.length < 2) {
      return _interpolatePoint(
        _fallbackPickupPoint,
        _fallbackDropPoint,
        t,
      );
    }

    final clampedT = t.clamp(0.0, 1.0);
    final totalSegments = points.length - 1;
    final scaled = clampedT * totalSegments;
    final segmentIndex = scaled.floor().clamp(0, totalSegments - 1);
    final localT = scaled - segmentIndex;

    if (segmentIndex >= totalSegments) {
      return points.last;
    }

    return _interpolatePoint(
        points[segmentIndex], points[segmentIndex + 1], localT);
  }

  LatLng _interpolatePoint(LatLng start, LatLng end, double t) {
    return LatLng(
      start.latitude + ((end.latitude - start.latitude) * t),
      start.longitude + ((end.longitude - start.longitude) * t),
    );
  }

  List<Marker> _buildTruckMarkers(double animationProgress) {
    final point = _pointAlongRoute(0.5);

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
            child: AnimatedBuilder(
              animation: _truckController,
              builder: (context, child) {
                return FlutterMap(
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
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: _routePoints.first,
                          width: 30,
                          height: 30,
                          child: Icon(Icons.trip_origin_rounded,
                              color: Colors.blue, size: 22),
                        ),
                        Marker(
                          point: _routePoints.last,
                          width: 34,
                          height: 34,
                          child: Icon(Icons.place_rounded,
                              color: Colors.redAccent, size: 26),
                        ),
                        ..._buildTruckMarkers(_truckController.value),
                      ],
                    ),
                  ],
                );
              },
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
                                  ),
                                ],
                              ),
                            ),
                            IconButton(
                              onPressed: () {},
                              icon: Icon(
                                Icons.more_vert_rounded,
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
                        Text('ETA: ${eta}',
                            style: Theme.of(context)
                                .textTheme
                                .bodyMedium
                                ?.copyWith(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        Text('Current location: ${currentLocation}',
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
                                onTap: _showVoiceAi),
                            _ActionTile(
                                icon: Icons.call_rounded,
                                label: 'Call Driver',
                                onTap: _showCallDriver),
                            _ActionTile(
                                icon: Icons.edit_location_alt_rounded,
                                label: 'Change Drop',
                                onTap: _showChangeDrop),
                            _ActionTile(
                                icon: Icons.close_rounded,
                                label: 'Cancel',
                                color: TruxifyColors.error,
                                onTap: _showCancel),
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
      required this.onTap,
      this.color = TruxifyColors.accentDark});

  final IconData icon;
  final String label;
  final VoidCallback onTap;
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
          Icon(icon, color: color),
          const SizedBox(height: 6),
          Text(label, textAlign: TextAlign.center),
        ],
      ),
    );
  }
}
