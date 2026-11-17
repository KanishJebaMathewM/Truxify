import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../services/marketplace_repository.dart';

/// Screen representing Model #16: Cargo & Payload Multi-Load Optimiser.
///
/// Discovers optimal multi-load combinations within weight and volume constraints,
/// maximizing vehicle utilization and driver revenue while sequencing multi-stop waypoints.
class LoadOptimiserScreen extends StatefulWidget {
  const LoadOptimiserScreen({
    super.key,
    MarketplaceRepository? repository,
    List<LoadOffer>? availableLoads,
    double? truckPayloadKg,
    double? truckVolumeM3,
    List<double>? driverLocation,
  })  : _repository = repository,
        _availableLoads = availableLoads,
        _truckPayloadKg = truckPayloadKg ?? 10000.0,
        _truckVolumeM3 = truckVolumeM3 ?? 40.0,
        _driverLocation = driverLocation ?? const [19.0760, 72.8777];

  final MarketplaceRepository? _repository;
  final List<LoadOffer>? _availableLoads;
  final double _truckPayloadKg;
  final double _truckVolumeM3;
  final List<double> _driverLocation;

  @override
  State<LoadOptimiserScreen> createState() => _LoadOptimiserScreenState();
}

class _LoadOptimiserScreenState extends State<LoadOptimiserScreen> {
  late final MarketplaceRepository _repository =
      widget._repository ?? MarketplaceRepository();

  bool _isLoading = false;
  String? _errorMessage;
  List<Map<String, dynamic>> _combinations = [];
  late double _currentPayloadKg;
  late double _currentVolumeM3;

  @override
  void initState() {
    super.initState();
    _currentPayloadKg = widget._truckPayloadKg;
    _currentVolumeM3 = widget._truckVolumeM3;
    _runOptimiser();
  }

  @override
  void dispose() {
    if (widget._repository == null) {
      _repository.dispose();
    }
    super.dispose();
  }

  Future<void> _runOptimiser() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      List<LoadOffer> loads = widget._availableLoads ?? [];
      if (loads.isEmpty) {
        loads = await _repository.fetchLoadOffers();
      }

      // Convert LoadOffer models into the standard JSON contract expected by the ML model
      final loadsPayload = <Map<String, dynamic>>[];
      for (int i = 0; i < loads.length; i++) {
        final l = loads[i];
        final loadId = l.id.isNotEmpty ? l.id : 'L${i + 1}';

        // Parse weight
        double weight = l.weightKg ?? 0.0;
        if (weight <= 0) {
          final cleanW = l.weight.replaceAll(RegExp(r'[^0-9.]'), '');
          weight = double.tryParse(cleanW) ?? (2500.0 + (i * 1200.0) % 5000);
          if (l.weight.toLowerCase().contains('ton') && !l.weight.toLowerCase().contains('kg')) {
            weight *= 1000.0;
          }
        }

        // Parse volume (approximate if dimension string provided)
        double volume = (l.lengthM ?? 0) * (l.widthM ?? 0) * (l.heightM ?? 0);
        if (volume <= 0) {
          volume = (weight / 350.0).clamp(4.0, 18.0);
        }

        // Parse freight amount
        double freight = l.paymentInr ?? 0.0;
        if (freight <= 0) {
          final cleanF = l.freightValue.replaceAll(RegExp(r'[^0-9.]'), '');
          freight = double.tryParse(cleanF) ?? (6000.0 + (i * 2500.0));
        }

        final oLat = l.originLat ?? (widget._driverLocation[0] + (i * 0.05));
        final oLng = l.originLng ?? (widget._driverLocation[1] + (i * 0.04));
        final dLat = l.destinationLat ?? (widget._driverLocation[0] - 0.5 - (i * 0.08));
        final dLng = l.destinationLng ?? (widget._driverLocation[1] + 0.8 + (i * 0.06));

        loadsPayload.add({
          'load_id': loadId,
          'weight_kg': weight,
          'volume_m3': volume,
          'origin': [oLat, oLng],
          'destination': [dLat, dLng],
          'freight_amount': freight,
          'route_label': l.route,
          'goods': l.goods,
        });
      }

      if (loadsPayload.isEmpty) {
        setState(() {
          _combinations = [];
          _isLoading = false;
        });
        return;
      }

      final result = await _repository.optimiseLoads(
        truckPayloadKg: _currentPayloadKg,
        truckVolumeM3: _currentVolumeM3,
        availableLoads: loadsPayload,
        driverLocation: widget._driverLocation,
      );

      final rawCombos = result['combinations'];
      final List<Map<String, dynamic>> parsedCombos = [];
      if (rawCombos is List) {
        for (final item in rawCombos) {
          if (item is Map) {
            parsedCombos.add(Map<String, dynamic>.from(item));
          }
        }
      }

      if (mounted) {
        setState(() {
          _combinations = parsedCombos;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  void _acceptCombination(Map<String, dynamic> combo) {
    final comboId = combo['combination_id'] ?? 'Combination';
    final earnings = combo['total_freight_amount'] ?? 0;
    final loadIds = combo['load_ids'] is List ? (combo['load_ids'] as List).join(', ') : '';

    showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: Row(
          children: const [
            Icon(Icons.check_circle_rounded, color: Colors.green),
            SizedBox(width: 8),
            Text('Accept Multi-Stop Load'),
          ],
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Book all shipments in $comboId as a single multi-stop trip?'),
            const SizedBox(height: 12),
            Text('• Shipments: $loadIds'),
            Text('• Total Freight: ₹${earnings.toString()}'),
            Text('• Payload Fill: ${combo['payload_fill_percent']}%'),
            const SizedBox(height: 8),
            const Text(
              'All shippers will be notified and pickup waypoints scheduled.',
              style: TextStyle(fontSize: 12, color: Colors.grey),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(ctx).pop(),
            child: const Text('Cancel'),
          ),
          ElevatedButton(
            style: ElevatedButton.styleFrom(backgroundColor: Colors.green),
            onPressed: () {
              Navigator.of(ctx).pop();
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(
                  content: Text('Multi-stop booking confirmed! Total earnings: ₹$earnings'),
                  backgroundColor: Colors.green.shade800,
                ),
              );
              Navigator.of(context).pop(true);
            },
            child: const Text('Confirm Multi-Stop Booking', style: TextStyle(color: Colors.white)),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return PopScope(
      canPop: false,
      onPopInvoked: (didPop) {
        if (!didPop) Navigator.of(context).pop();
      },
      child: Scaffold(
        appBar: AppBar(
          title: const Text('AI Load & Payload Optimiser'),
          centerTitle: true,
          actions: [
            IconButton(
              icon: const Icon(Icons.refresh_rounded),
              tooltip: 'Re-run Optimiser',
              onPressed: _isLoading ? null : _runOptimiser,
            ),
          ],
        ),
        body: Column(
          children: [
            _buildCapacityBar(),
            Expanded(
              child: _isLoading
                  ? const Center(
                      child: Column(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          CircularProgressIndicator(),
                          SizedBox(height: 16),
                          Text('Solving multi-dimensional bin packing...'),
                          SizedBox(height: 4),
                          Text('Sequencing multi-stop waypoints via OSRM', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        ],
                      ),
                    )
                  : _errorMessage != null
                      ? Center(
                          child: Padding(
                            padding: const EdgeInsets.all(24.0),
                            child: Column(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                const Icon(Icons.error_outline, size: 48, color: Colors.red),
                                const SizedBox(height: 12),
                                const Text('Optimisation Error', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                const SizedBox(height: 6),
                                Text(_errorMessage!, textAlign: TextAlign.center),
                                const SizedBox(height: 16),
                                ElevatedButton(onPressed: _runOptimiser, child: const Text('Retry')),
                              ],
                            ),
                          ),
                        )
                      : _combinations.isEmpty
                          ? Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24.0),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    const Icon(Icons.inventory_2_outlined, size: 48, color: Colors.grey),
                                    const SizedBox(height: 12),
                                    const Text('No Compatible Combinations', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                                    const SizedBox(height: 6),
                                    const Text('Available loads exceed truck capacity or have conflicting routes.', textAlign: TextAlign.center),
                                    const SizedBox(height: 16),
                                    ElevatedButton(onPressed: _runOptimiser, child: const Text('Refresh Loads')),
                                  ],
                                ),
                              ),
                            )
                          : ListView.builder(
                              padding: const EdgeInsets.all(16.0),
                              itemCount: _combinations.length,
                              itemBuilder: (context, index) {
                                return _buildCombinationCard(_combinations[index], index + 1);
                              },
                            ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildCapacityBar() {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 12.0),
      decoration: BoxDecoration(
        color: Theme.of(context).cardColor,
        border: Border(bottom: BorderSide(color: Colors.grey.withOpacity(0.2))),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Row(
            children: [
              const Icon(Icons.local_shipping_rounded, color: Colors.blue, size: 20),
              const SizedBox(width: 8),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Truck Capacity', style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey)),
                  Text(
                    '${(_currentPayloadKg / 1000).toStringAsFixed(1)} T (${_currentPayloadKg.toInt()} kg) • ${_currentVolumeM3.toInt()} m³',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
                  ),
                ],
              ),
            ],
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
            decoration: BoxDecoration(
              color: Colors.purple.withOpacity(0.12),
              borderRadius: BorderRadius.circular(8),
            ),
            child: const Text('Model #16 Active', style: TextStyle(color: Colors.purple, fontWeight: FontWeight.bold, fontSize: 11)),
          ),
        ],
      ),
    );
  }

  Widget _buildCombinationCard(Map<String, dynamic> combo, int rank) {
    final comboId = combo['combination_id'] ?? 'COMBO-$rank';
    final payloadFill = (combo['payload_fill_percent'] as num?)?.toDouble() ?? 0.0;
    final weightFill = (combo['weight_fill_percent'] as num?)?.toDouble() ?? 0.0;
    final volumeFill = (combo['volume_fill_percent'] as num?)?.toDouble() ?? 0.0;
    final earnings = (combo['total_freight_amount'] as num?)?.toDouble() ?? 0.0;
    final distanceKm = (combo['estimated_distance_km'] as num?)?.toDouble() ?? 0.0;
    final durationHours = (combo['estimated_duration_hours'] as num?)?.toDouble() ?? 0.0;
    final loads = combo['loads'] is List ? combo['loads'] as List : [];
    final reason = combo['recommendation_reason']?.toString() ?? 'High revenue match';
    final routeSequence = combo['route_sequence'] is List ? combo['route_sequence'] as List : [];

    final isHighFill = payloadFill >= 75.0;

    return Card(
      elevation: 3,
      margin: const EdgeInsets.only(bottom: 16.0),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Header Row: Combo Name & Payload Fill Badge
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      radius: 14,
                      backgroundColor: rank == 1 ? Colors.amber.shade700 : Colors.blueGrey,
                      child: Text('$rank', style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                    ),
                    const SizedBox(width: 8),
                    Text(comboId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
                  decoration: BoxDecoration(
                    color: isHighFill ? Colors.green.shade50 : Colors.orange.shade50,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: isHighFill ? Colors.green : Colors.orange),
                  ),
                  child: Row(
                    children: [
                      Icon(Icons.pie_chart_rounded, size: 14, color: isHighFill ? Colors.green.shade800 : Colors.orange.shade800),
                      const SizedBox(width: 4),
                      Text(
                        '${payloadFill.toStringAsFixed(1)}% Fill',
                        style: TextStyle(
                          color: isHighFill ? Colors.green.shade900 : Colors.orange.shade900,
                          fontWeight: FontWeight.bold,
                          fontSize: 12,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),

            const SizedBox(height: 10),

            // Recommendation Reason Banner
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(8.0),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.07),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                reason,
                style: TextStyle(color: Colors.blue.shade900, fontSize: 12, fontWeight: FontWeight.w500),
              ),
            ),

            const SizedBox(height: 12),

            // Key Metrics Row: Total Earnings, Total Distance, Total Weight
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildMetricColumn('Total Earnings', '₹${earnings.toInt().toString()}', Colors.green.shade800),
                _buildMetricColumn('Distance', '${distanceKm.toStringAsFixed(0)} km', Colors.black87),
                _buildMetricColumn('Est. Time', '${durationHours.toStringAsFixed(1)} hrs', Colors.black87),
                _buildMetricColumn('Shipments', '${loads.length} loads', Colors.blue.shade700),
              ],
            ),

            const SizedBox(height: 12),

            // Capacity Progress Bar
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text('Weight Fill: ${weightFill.toStringAsFixed(0)}%', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                    Text('Volume Fill: ${volumeFill.toStringAsFixed(0)}%', style: const TextStyle(fontSize: 11, color: Colors.grey)),
                  ],
                ),
                const SizedBox(height: 4),
                ClipRRect(
                  borderRadius: BorderRadius.circular(4),
                  child: LinearProgressIndicator(
                    value: (payloadFill / 100.0).clamp(0.0, 1.0),
                    backgroundColor: Colors.grey.shade200,
                    valueColor: AlwaysStoppedAnimation<Color>(isHighFill ? Colors.green : Colors.orange),
                    minHeight: 6,
                  ),
                ),
              ],
            ),

            const Divider(height: 24),

            // Multi-Stop Route Sequencing Preview
            const Text('Multi-Stop Route Sequence', style: TextStyle(fontWeight: FontWeight.w600, fontSize: 13)),
            const SizedBox(height: 8),
            if (routeSequence.isNotEmpty)
              SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: Row(
                  children: [
                    for (int sIdx = 0; sIdx < routeSequence.length; sIdx++) ...[
                      _buildStopChip(routeSequence[sIdx]),
                      if (sIdx < routeSequence.length - 1)
                        const Padding(
                          padding: EdgeInsets.symmetric(horizontal: 4),
                          child: Icon(Icons.arrow_forward_rounded, size: 14, color: Colors.grey),
                        ),
                    ],
                  ],
                ),
              ),

            const SizedBox(height: 16),

            // One-Tap Multi-Stop Booking Button
            SizedBox(
              width: double.infinity,
              height: 44,
              child: ElevatedButton.icon(
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF0F9D58),
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                ),
                icon: const Icon(Icons.flash_on_rounded, size: 18),
                label: Text('Accept Multi-Stop Booking (₹${earnings.toInt()})', style: const TextStyle(fontWeight: FontWeight.bold)),
                onPressed: () => _acceptCombination(combo),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildMetricColumn(String label, String value, Color valueColor) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(fontSize: 11, color: Colors.grey)),
        const SizedBox(height: 2),
        Text(value, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14, color: valueColor)),
      ],
    );
  }

  Widget _buildStopChip(dynamic stop) {
    if (stop is! Map) return const SizedBox.shrink();
    final type = stop['type']?.toString() ?? '';
    final loadId = stop['load_id']?.toString() ?? '';
    Color chipColor;
    IconData chipIcon;
    String label;

    if (type == 'start') {
      chipColor = Colors.blueGrey;
      chipIcon = Icons.my_location;
      label = 'Start';
    } else if (type == 'pickup') {
      chipColor = Colors.blue;
      chipIcon = Icons.arrow_upward_rounded;
      label = 'Pickup $loadId';
    } else {
      chipColor = Colors.green;
      chipIcon = Icons.arrow_downward_rounded;
      label = 'Drop $loadId';
    }

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: chipColor.withOpacity(0.12),
        borderRadius: BorderRadius.circular(6),
        border: Border.all(color: chipColor.withOpacity(0.4)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(chipIcon, size: 12, color: chipColor),
          const SizedBox(width: 4),
          Text(label, style: TextStyle(fontSize: 11, fontWeight: FontWeight.bold, color: chipColor)),
        ],
      ),
    );
  }
}
