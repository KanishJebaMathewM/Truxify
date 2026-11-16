import 'package:flutter/material.dart';
import 'package:qr_flutter/qr_flutter.dart';

class EwayBillQrCard extends StatelessWidget {
  final String ewbNumber;
  final String vehicleNumber;
  final String status;
  final DateTime validUpto;
  final String? polygonTxHash;
  final String apiBaseUrl;

  const EwayBillQrCard({
    super.key,
    required this.ewbNumber,
    required this.vehicleNumber,
    required this.status,
    required this.validUpto,
    required this.apiBaseUrl,
    this.polygonTxHash,
  });

  String get _verificationUrl => '$apiBaseUrl/api/eway-bills/inspect/$ewbNumber';

  Duration get _timeRemaining => validUpto.difference(DateTime.now());

  @override
  Widget build(BuildContext context) {
    final isAtRisk = _timeRemaining.inHours < 4 && !_timeRemaining.isNegative;
    final isExpired = _timeRemaining.isNegative;

    final badgeColor = isExpired
        ? Colors.red
        : isAtRisk
            ? Colors.orange
            : Colors.green;

    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  'GST e-Way Bill #$ewbNumber',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.bold,
                      ),
                ),
                Chip(
                  label: Text(
                    status,
                    style: const TextStyle(color: Colors.white, fontSize: 12),
                  ),
                  backgroundColor: badgeColor,
                ),
              ],
            ),
            const SizedBox(height: 8),
            Text('Vehicle: $vehicleNumber'),
            Text(
              isExpired
                  ? 'Status: EXPIRED'
                  : 'Valid for: ${_timeRemaining.inHours}h ${_timeRemaining.inMinutes.remainder(60)}m',
              style: TextStyle(
                fontWeight: FontWeight.w600,
                color: badgeColor,
              ),
            ),
            const Divider(height: 24),
            Center(
              child: QrImageView(
                data: _verificationUrl,
                version: QrVersions.auto,
                size: 160,
              ),
            ),
            const SizedBox(height: 8),
            Center(
              child: Text(
                'Scan for Polygon Blockchain Audit Proof',
                style: Theme.of(context).textTheme.bodySmall,
              ),
            ),
            if (polygonTxHash != null) ...[
              const SizedBox(height: 6),
              Center(
                child: Text(
                  'Polygon Tx: ${polygonTxHash!.substring(0, 10)}...${polygonTxHash!.substring(polygonTxHash!.length - 6)}',
                  style: Theme.of(context).textTheme.labelSmall?.copyWith(
                        color: Colors.indigo,
                      ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}