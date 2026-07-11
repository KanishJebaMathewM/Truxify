import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../services/trip_service.dart';
import '../theme/app_theme.dart';

class LoadPointDetailScreen extends StatefulWidget {
  const LoadPointDetailScreen({super.key, required this.point});

  final RouteMapPoint point;

  @override
  State<LoadPointDetailScreen> createState() => _LoadPointDetailScreenState();
}

class _LoadPointDetailScreenState extends State<LoadPointDetailScreen> {
  late RouteMapPoint _point;
  final TripService _tripService = TripService();
  bool _saving = false;

  @override
  void initState() {
    super.initState();
    _point = widget.point;
  }

  @override
  void didUpdateWidget(covariant LoadPointDetailScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.point != widget.point) {
      _point = widget.point;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(_point.title), backgroundColor: TruxifyColors.secondaryBackground),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16.0),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(_point.subtitle, style: Theme.of(context).textTheme.titleMedium),
              const SizedBox(height: 12),
              Text(_point.details, style: Theme.of(context).textTheme.bodyMedium),
              const SizedBox(height: 18),
              Row(
                children: [
                  ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      minimumSize: const Size(120, 44),
                      padding: const EdgeInsets.symmetric(horizontal: 16),
                    ),
                    onPressed: _saving
                        ? null
                        : () async {
                            final nextClaimed = !_point.claimed;
                            setState(() => _saving = true);
                            try {
                              await _tripService.setRoutePointClaimed(
                                _point.id,
                                nextClaimed,
                              );
                              if (!mounted) return;
                              setState(() {
                                _point = _point.copyWith(claimed: nextClaimed);
                              });
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(
                                  content: Text(
                                    nextClaimed ? 'Marked as claimed' : 'Marked as available',
                                  ),
                                ),
                              );
                            } catch (e) {
                              if (!mounted) return;
                              ScaffoldMessenger.of(context).showSnackBar(
                                SnackBar(content: Text('Failed to update: $e')),
                              );
                            } finally {
                              if (mounted) setState(() => _saving = false);
                            }
                          },
                    child: Text(_point.claimed ? 'Unclaim' : 'Claim'),
                  ),
                  const SizedBox(width: 12),
                  Text(_point.claimed ? 'Claimed' : 'Available', style: const TextStyle(fontWeight: FontWeight.w700)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
