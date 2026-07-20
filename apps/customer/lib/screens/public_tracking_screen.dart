import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:latlong2/latlong.dart';
import 'package:url_launcher/url_launcher.dart';
import '../services/tracking_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class PublicTrackingScreen extends StatefulWidget {
  const PublicTrackingScreen({super.key, required this.token});

  final String token;

  @override
  State<PublicTrackingScreen> createState() => _PublicTrackingScreenState();
}

class _PublicTrackingScreenState extends State<PublicTrackingScreen> {
  final TrackingService _trackingService = TrackingService();
  Map<String, dynamic>? _order;
  List<Map<String, dynamic>> _timeline = [];
  Map<String, dynamic>? _driverLocation;
  bool _isLoading = true;
  String? _error;
  Timer? _refreshTimer;
  MapController _mapController = MapController();

  static const Duration _refreshInterval = Duration(seconds: 15);

  @override
  void initState() {
    super.initState();
    _loadTrackingData();
    _refreshTimer = Timer.periodic(_refreshInterval, (_) => _loadTrackingData());
  }

  @override
  void dispose() {
    _refreshTimer?.cancel();
    super.dispose();
  }

  Future<void> _loadTrackingData() async {
    try {
      final data = await _trackingService.fetchPublicTracking(widget.token);

      if (!mounted) return;

      if (data == null) {
        setState(() {
          _error = 'This tracking link has expired or is no longer valid.';
          _isLoading = false;
        });
        _refreshTimer?.cancel();
        return;
      }

      setState(() {
        _order = data['order'] as Map<String, dynamic>?;
        _timeline = (data['timeline'] as List<dynamic>?)
                ?.map((t) => Map<String, dynamic>.from(t as Map))
                .toList() ??
            [];
        _driverLocation = data['driver_location'] as Map<String, dynamic>?;
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = 'Unable to load tracking information.';
        _isLoading = false;
      });
    }
  }

  String _formatStatus(String status) {
    switch (status) {
      case 'driver_assigned':
      case 'truck_assigned':
        return 'Truck Assigned';
      case 'en_route_pickup':
        return 'En Route to Pickup';
      case 'arrived_pickup':
        return 'Arrived at Pickup';
      case 'picked_up':
        return 'Goods Loaded';
      case 'in_transit':
        return 'In Transit';
      case 'arriving':
        return 'Arriving';
      case 'delivered':
      case 'completed':
        return 'Delivered';
      case 'cancelled':
        return 'Cancelled';
      case 'payment_released':
        return 'Payment Released';
      case 'pending':
        return 'Pending';
      default:
        return status
            .split('_')
            .map((w) => w.isEmpty ? w : '${w[0].toUpperCase()}${w.substring(1)}')
            .join(' ');
    }
  }

  Color _statusColor(String status) {
    switch (status) {
      case 'in_transit':
      case 'arriving':
        return TruxifyColors.accent;
      case 'delivered':
      case 'payment_released':
        return TruxifyColors.success;
      case 'cancelled':
        return TruxifyColors.error;
      default:
        return TruxifyColors.accentDark;
    }
  }

  LatLng? _getPickupLatLng() {
    final lat = _order?['pickup_lat'];
    final lng = _order?['pickup_lng'];
    if (lat == null || lng == null) return null;
    return LatLng((lat as num).toDouble(), (lng as num).toDouble());
  }

  LatLng? _getDropLatLng() {
    final lat = _order?['drop_lat'];
    final lng = _order?['drop_lng'];
    if (lat == null || lng == null) return null;
    return LatLng((lat as num).toDouble(), (lng as num).toDouble());
  }

  LatLng? _getDriverLatLng() {
    final lat = _driverLocation?['latitude'];
    final lng = _driverLocation?['longitude'];
    if (lat == null || lng == null) return null;
    return LatLng((lat as num).toDouble(), (lng as num).toDouble());
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        body: const Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              CircularProgressIndicator(),
              SizedBox(height: 16),
              Text('Loading tracking information...'),
            ],
          ),
        ),
      );
    }

    if (_error != null) {
      return Scaffold(
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(32),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  Icons.link_off_rounded,
                  size: 64,
                  color: TruxifyColors.error.withValues(alpha: 0.7),
                ),
                const SizedBox(height: 16),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                ),
                const SizedBox(height: 8),
                Text(
                  'This link may have expired or been revoked by the sender.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final order = _order!;
    final status = order['status']?.toString() ?? '';
    final statusLabel = _formatStatus(status);
    final statusColor = _statusColor(status);
    final pickup = order['pickup_address']?.toString() ?? '—';
    final drop = order['drop_address']?.toString() ?? '—';
    final driverName = order['driver_name']?.toString() ?? 'Driver not assigned';
    final truckNumber = order['truck_number']?.toString() ?? '';
    final eta = order['eta']?.toString() ?? '';
    final goodsType = order['goods_type']?.toString() ?? '';
    final weight = order['weight_tonnes']?.toString() ?? '';

    final pickupLatLng = _getPickupLatLng();
    final dropLatLng = _getDropLatLng();
    final driverLatLng = _getDriverLatLng();

    final hasMapData = pickupLatLng != null && dropLatLng != null;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Shipment Tracking'),
        backgroundColor: Theme.of(context).colorScheme.surface,
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _loadTrackingData,
            icon: const Icon(Icons.refresh_rounded),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // ── Map ──────────────────────────────────────────────────────
            if (hasMapData)
              SizedBox(
                height: 250,
                child: FlutterMap(
                  mapController: _mapController,
                  options: MapOptions(
                    initialCenter: driverLatLng ?? pickupLatLng,
                    initialZoom: driverLatLng != null ? 12 : 10,
                    interactionOptions: const InteractionOptions(
                      flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
                    ),
                  ),
                  children: [
                    TileLayer(
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      tileProvider: CancellableNetworkTileProvider(),
                    ),
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: [pickupLatLng, dropLatLng],
                          color: TruxifyColors.accentDark.withValues(alpha: 0.5),
                          strokeWidth: 3,
                        ),
                      ],
                    ),
                    MarkerLayer(
                      markers: [
                        Marker(
                          point: pickupLatLng,
                          width: 32,
                          height: 32,
                          child: const Icon(Icons.circle, color: Colors.blue, size: 16),
                        ),
                        Marker(
                          point: dropLatLng,
                          width: 32,
                          height: 32,
                          child: const Icon(Icons.circle, color: Colors.red, size: 16),
                        ),
                        if (driverLatLng != null)
                          Marker(
                            point: driverLatLng,
                            width: 36,
                            height: 36,
                            child: Container(
                              decoration: BoxDecoration(
                                color: TruxifyColors.accent,
                                shape: BoxShape.circle,
                                border: Border.all(color: Colors.white, width: 2),
                              ),
                              child: const Icon(Icons.local_shipping_rounded, color: Colors.white, size: 18),
                            ),
                          ),
                      ],
                    ),
                  ],
                ),
              ),

            Padding(
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // ── Status Banner ────────────────────────────────────
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: statusColor.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (status == 'in_transit' || status == 'arriving') ...[
                          const LiveDot(color: TruxifyColors.accent, size: 8),
                          const SizedBox(width: 6),
                        ],
                        Text(
                          statusLabel,
                          style: TextStyle(
                            fontWeight: FontWeight.w700,
                            color: statusColor,
                            fontSize: 14,
                          ),
                        ),
                      ],
                    ),
                  ),
                  const SizedBox(height: 16),

                  // ── Order ID ──────────────────────────────────────────
                  Text(
                    order['order_display_id']?.toString() ?? '',
                    style: Theme.of(context).textTheme.titleLarge?.copyWith(
                          fontWeight: FontWeight.w800,
                        ),
                  ),
                  const SizedBox(height: 12),

                  // ── Route ─────────────────────────────────────────────
                  _InfoRow(icon: Icons.circle, iconColor: Colors.blue, label: 'Pickup', value: pickup),
                  const SizedBox(height: 8),
                  _InfoRow(icon: Icons.circle, iconColor: Colors.red, label: 'Drop', value: drop),
                  const SizedBox(height: 16),

                  // ── Driver Info ───────────────────────────────────────
                  if (driverName.isNotEmpty && driverName != 'Driver not assigned') ...[
                    _InfoRow(
                      icon: Icons.person_rounded,
                      label: 'Driver',
                      value: driverName,
                    ),
                    if (truckNumber.isNotEmpty) ...[
                      const SizedBox(height: 8),
                      _InfoRow(
                        icon: Icons.local_shipping_rounded,
                        label: 'Truck',
                        value: truckNumber,
                      ),
                    ],
                    const SizedBox(height: 8),
                  ],

                  if (eta.isNotEmpty) ...[
                    _InfoRow(icon: Icons.access_time_rounded, label: 'ETA', value: eta),
                    const SizedBox(height: 8),
                  ],

                  if (goodsType.isNotEmpty) ...[
                    _InfoRow(icon: Icons.inventory_2_rounded, label: 'Goods', value: '$goodsType (${weight}T)'),
                    const SizedBox(height: 16),
                  ],

                  // ── Timeline ──────────────────────────────────────────
                  if (_timeline.isNotEmpty) ...[
                    Text(
                      'Shipment Timeline',
                      style: Theme.of(context).textTheme.titleMedium?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                    ),
                    const SizedBox(height: 12),
                    ..._timeline.map((step) {
                      final completed = step['completed'] == true;
                      final milestone = step['milestone']?.toString() ?? '';
                      final time = step['milestone_time']?.toString();
                      String timeStr = '';
                      if (time != null && time.isNotEmpty) {
                        final parsed = DateTime.tryParse(time);
                        if (parsed != null) {
                          final h = parsed.toLocal().hour.toString().padLeft(2, '0');
                          final m = parsed.toLocal().minute.toString().padLeft(2, '0');
                          timeStr = '$h:$m';
                        }
                      }
                      return _TimelineStep(
                        milestone: milestone,
                        time: timeStr,
                        completed: completed,
                        isLast: step == _timeline.last,
                      );
                    }),
                  ],

                  const SizedBox(height: 32),

                  // ── Powered by ────────────────────────────────────────
                  Center(
                    child: Text(
                      'Powered by Truxify',
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: TruxifyColors.adaptiveSecondaryText(context),
                          ),
                    ),
                  ),
                  const SizedBox(height: 16),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoRow extends StatelessWidget {
  const _InfoRow({
    required this.icon,
    required this.label,
    required this.value,
    this.iconColor,
  });

  final IconData icon;
  final String label;
  final String value;
  final Color? iconColor;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Icon(icon, size: 14, color: iconColor ?? TruxifyColors.accentDark),
        const SizedBox(width: 10),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
              ),
              Text(
                value,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      fontWeight: FontWeight.w600,
                    ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ],
          ),
        ),
      ],
    );
  }
}

class _TimelineStep extends StatelessWidget {
  const _TimelineStep({
    required this.milestone,
    required this.time,
    required this.completed,
    required this.isLast,
  });

  final String milestone;
  final String time;
  final bool completed;
  final bool isLast;

  @override
  Widget build(BuildContext context) {
    final color = completed ? TruxifyColors.accentDark : TruxifyColors.border;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Column(
          children: [
            Icon(
              completed ? Icons.check_circle : Icons.radio_button_unchecked,
              color: color,
              size: 20,
            ),
            if (!isLast)
              Container(
                width: 2,
                height: 28,
                color: color.withValues(alpha: 0.3),
              ),
          ],
        ),
        const SizedBox(width: 12),
        Expanded(
          child: Padding(
            padding: const EdgeInsets.only(bottom: 12),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  milestone,
                  style: TextStyle(
                    fontWeight: completed ? FontWeight.w700 : FontWeight.w500,
                    color: completed
                        ? Theme.of(context).textTheme.bodyMedium?.color
                        : TruxifyColors.adaptiveSecondaryText(context),
                    fontSize: 14,
                  ),
                ),
                if (time.isNotEmpty)
                  Text(
                    time,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                  ),
              ],
            ),
          ),
        ),
      ],
    );
  }
}
