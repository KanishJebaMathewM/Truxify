import 'package:flutter/material.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';

class LoadPointDetailScreen extends StatefulWidget {
  const LoadPointDetailScreen({super.key, required this.point});

  final RouteMapPoint point;

  @override
  State<LoadPointDetailScreen> createState() => _LoadPointDetailScreenState();
}

class _LoadPointDetailScreenState extends State<LoadPointDetailScreen> {
  late RouteMapPoint _point;

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
                    onPressed: () {
                      setState(() {
                        _point = _point.copyWith(claimed: !_point.claimed);
                      });
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(content: Text(_point.claimed ? 'Marked as claimed' : 'Marked as available')),
                      );
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
