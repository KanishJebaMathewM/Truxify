import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_map_cancellable_tile_provider/flutter_map_cancellable_tile_provider.dart';
import 'package:latlong2/latlong.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class LiveTrackingScreen extends StatefulWidget {
  const LiveTrackingScreen({super.key, required this.orderId});

  final String orderId;

  @override
  State<LiveTrackingScreen> createState() => _LiveTrackingScreenState();
}

class _LiveTrackingScreenState extends State<LiveTrackingScreen> with SingleTickerProviderStateMixin {
  late final AnimationController _truckController;
  int _selectedTruckIndex = 0;

  @override
  void initState() {
    super.initState();
    _truckController = AnimationController(vsync: this, duration: const Duration(seconds: 9))..repeat();
  }

  @override
  void dispose() {
    _truckController.dispose();
    super.dispose();
  }

  Future<void> _showVoiceAi() async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Container(width: 46, height: 5, decoration: BoxDecoration(color: FreightFairColors.border, borderRadius: BorderRadius.circular(999))),
              const SizedBox(height: 18),
              const CircleAvatar(radius: 34, backgroundColor: FreightFairColors.accentLight, child: Icon(Icons.mic_rounded, color: FreightFairColors.accentDark, size: 34)),
              const SizedBox(height: 16),
              Text('Voice AI', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 8),
              Text(
                'Your truck is near Vadodara, expected by 4:30 PM today',
                textAlign: TextAlign.center,
                style: Theme.of(context).textTheme.bodyLarge?.copyWith(color: FreightFairColors.secondaryText),
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
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const SizedBox(height: 8),
              const Icon(Icons.call_rounded, color: FreightFairColors.accentDark, size: 42),
              const SizedBox(height: 10),
              Text('Calling ${mockLiveTrackers[_selectedTruckIndex].driver}', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 4),
              Text(mockLiveTrackers[_selectedTruckIndex].truckNumber, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.secondaryText)),
              const SizedBox(height: 18),
              PrimaryButton(label: 'End Call', onPressed: () => Navigator.of(context).pop()),
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
          padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom),
          child: Container(
            padding: const EdgeInsets.all(20),
            decoration: const BoxDecoration(
              color: Colors.white,
              borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Change Drop', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 14),
                TextField(controller: newDropController, decoration: const InputDecoration(labelText: 'New drop location')),
                const SizedBox(height: 16),
                InfoCard(
                  child: Row(
                    children: [
                      const Icon(Icons.attach_money_rounded, color: FreightFairColors.accentDark),
                      const SizedBox(width: 10),
                      Expanded(child: Text('New estimated price: ₹7,120', style: Theme.of(context).textTheme.bodyLarge?.copyWith(fontWeight: FontWeight.w700))),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                PrimaryButton(label: 'Request Change', onPressed: () => Navigator.of(context).pop()),
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
          decoration: const BoxDecoration(
            color: Colors.white,
            borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(Icons.warning_amber_rounded, color: FreightFairColors.warning, size: 42),
              const SizedBox(height: 10),
              Text('Cancellation fee ₹680', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 6),
              Text('This fee is charged for cancelling after assignment.', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.secondaryText)),
              const SizedBox(height: 18),
              PrimaryButton(label: 'Confirm Cancel', backgroundColor: FreightFairColors.error, onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        );
      },
    );
  }

  static const LatLng _pickupPoint = LatLng(21.1702, 72.8311);
  static const LatLng _dropPoint = LatLng(26.9124, 75.7873);
  static const List<double> _truckOffsets = <double>[0.44, 0.31];

  LatLng _interpolatePoint(double t) {
    return LatLng(
      _pickupPoint.latitude + ((_dropPoint.latitude - _pickupPoint.latitude) * t),
      _pickupPoint.longitude + ((_dropPoint.longitude - _pickupPoint.longitude) * t),
    );
  }

  List<Marker> _buildTruckMarkers(double animationProgress) {
    return List<Marker>.generate(mockLiveTrackers.length, (index) {
      final offset = _truckOffsets[index % _truckOffsets.length];
      final progress = (offset + (animationProgress * 0.08)).clamp(0.05, 0.95);
      final point = _interpolatePoint(progress);
      final isSelected = index == _selectedTruckIndex;

      return Marker(
        point: point,
        width: 54,
        height: 54,
        child: Container(
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            color: isSelected ? FreightFairColors.accentDark : Colors.white,
            border: Border.all(color: Colors.white, width: 2),
            boxShadow: const [BoxShadow(color: Color(0x33000000), blurRadius: 8, offset: Offset(0, 3))],
          ),
          child: Icon(
            Icons.local_shipping_rounded,
            color: isSelected ? Colors.white : FreightFairColors.accentDark,
            size: 26,
          ),
        ),
      );
    });
  }

  @override
  Widget build(BuildContext context) {
    final truck = mockLiveTrackers[_selectedTruckIndex];

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
                      urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      tileProvider: CancellableNetworkTileProvider(),
                      userAgentPackageName: 'com.freightfair.customer',
                    ),
                    PolylineLayer(
                      polylines: [
                        Polyline(
                          points: const [_pickupPoint, _dropPoint],
                          strokeWidth: 4,
                          color: FreightFairColors.accentDark,
                        ),
                      ],
                    ),
                    MarkerLayer(
                      markers: [
                        const Marker(
                          point: _pickupPoint,
                          width: 30,
                          height: 30,
                          child: Icon(Icons.trip_origin_rounded, color: Colors.blue, size: 22),
                        ),
                        const Marker(
                          point: _dropPoint,
                          width: 34,
                          height: 34,
                          child: Icon(Icons.place_rounded, color: Colors.redAccent, size: 26),
                        ),
                        ..._buildTruckMarkers(_truckController.value),
                      ],
                    ),
                  ],
                );
              },
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 8),
              child: Row(
                children: [
                  IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.arrow_back_rounded, color: Colors.white)),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(widget.orderId, style: Theme.of(context).textTheme.titleMedium?.copyWith(color: Colors.white, fontWeight: FontWeight.w800)),
                        const SizedBox(height: 4),
                        Row(
                          children: const [
                            LiveDot(color: Colors.white, size: 10),
                            SizedBox(width: 8),
                            Text('Live', style: TextStyle(color: Colors.white, fontWeight: FontWeight.w700)),
                          ],
                        ),
                      ],
                    ),
                  ),
                  IconButton(onPressed: () {}, icon: const Icon(Icons.more_vert_rounded, color: Colors.white)),
                ],
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
                  decoration: const BoxDecoration(
                    color: Colors.white,
                    borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                    boxShadow: [BoxShadow(color: Color(0x20000000), blurRadius: 16, offset: Offset(0, -2))],
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
                            decoration: BoxDecoration(color: FreightFairColors.border, borderRadius: BorderRadius.circular(999)),
                          ),
                        ),
                        const SizedBox(height: 14),
                        if (mockLiveTrackers.length > 1)
                          SizedBox(
                            height: 42,
                            child: ListView.separated(
                              scrollDirection: Axis.horizontal,
                              itemCount: mockLiveTrackers.length,
                              separatorBuilder: (_, __) => const SizedBox(width: 8),
                              itemBuilder: (context, index) {
                                return ChoiceChip(
                                  label: Text(mockLiveTrackers[index].label),
                                  selected: _selectedTruckIndex == index,
                                  onSelected: (_) => setState(() => _selectedTruckIndex = index),
                                );
                              },
                            ),
                          ),
                        if (mockLiveTrackers.length > 1) const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(child: Text(truck.driver, style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800))),
                            StatusBadge(label: '⭐ ${truck.rating.toStringAsFixed(1)}', color: FreightFairColors.accentDark, filled: true),
                          ],
                        ),
                        const SizedBox(height: 6),
                        Text(truck.truckNumber, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.secondaryText)),
                        const SizedBox(height: 6),
                        Text('ETA: ${truck.eta}', style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: FontWeight.w700)),
                        const SizedBox(height: 6),
                        Text('Current location: ${truck.location}', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: FreightFairColors.secondaryText)),
                        const SizedBox(height: 18),
                        SingleChildScrollView(
                          scrollDirection: Axis.horizontal,
                          child: Row(
                            children: const [
                              _MilestoneItem(label: 'Order Placed', done: true),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'Truck Assigned', done: true),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'Picked Up', done: true),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'In Transit', done: true, current: true),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'Arriving', done: false),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'Delivered', done: false),
                              _MilestoneConnector(),
                              _MilestoneItem(label: 'Payment Released', done: false),
                            ],
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
                            _ActionTile(icon: Icons.mic_rounded, label: 'Voice AI', onTap: _showVoiceAi),
                            _ActionTile(icon: Icons.call_rounded, label: 'Call Driver', onTap: _showCallDriver),
                            _ActionTile(icon: Icons.edit_location_alt_rounded, label: 'Change Drop', onTap: _showChangeDrop),
                            _ActionTile(icon: Icons.close_rounded, label: 'Cancel', color: FreightFairColors.error, onTap: _showCancel),
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

class _MilestoneItem extends StatelessWidget {
  const _MilestoneItem({required this.label, required this.done, this.current = false});

  final String label;
  final bool done;
  final bool current;

  @override
  Widget build(BuildContext context) {
    final color = current ? FreightFairColors.accent : done ? FreightFairColors.accentDark : FreightFairColors.border;
    return Column(
      children: [
        Container(
          width: 18,
          height: 18,
          decoration: BoxDecoration(
            color: color,
            shape: BoxShape.circle,
            boxShadow: current
                ? [BoxShadow(color: FreightFairColors.accent.withValues(alpha: 0.3), blurRadius: 8, spreadRadius: 1)]
                : const [],
          ),
        ),
        const SizedBox(height: 8),
        SizedBox(
          width: 70,
          child: Text(label, textAlign: TextAlign.center, style: Theme.of(context).textTheme.labelSmall?.copyWith(fontWeight: FontWeight.w700, color: color)),
        ),
      ],
    );
  }
}

class _MilestoneConnector extends StatelessWidget {
  const _MilestoneConnector();

  @override
  Widget build(BuildContext context) {
    return Container(width: 28, height: 2, color: FreightFairColors.border);
  }
}

class _ActionTile extends StatelessWidget {
  const _ActionTile({required this.icon, required this.label, required this.onTap, this.color = FreightFairColors.accentDark});

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
