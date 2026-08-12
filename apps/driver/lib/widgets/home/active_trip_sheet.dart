import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../theme/app_theme.dart';
import '../slide_to_confirm_button.dart';
import 'trip_spec.dart';

/// Bottom card shown on the Home screen when the driver has an active trip.
///
/// Displays:
/// - Status badge (e.g. EN-ROUTE, ASSIGNED, LOADING, DELIVERED)
/// - Origin → destination route
/// - Distance, estimated duration, payout
/// - ETA chip
/// - Trip completion progress bar (% complete)
/// - Start / Complete slide-to-confirm action
class ActiveTripSheet extends StatelessWidget {
  const ActiveTripSheet({
    super.key,
    required this.isTripStarted,
    required this.truckLabel,
    required this.currentLocationLabel,
    required this.destinationAddress,
    required this.distance,
    required this.duration,
    required this.payout,
    required this.onStartTrip,
    required this.onCompleteTrip,
    required this.onCancel,
    required this.onOpenMaps,
    this.stopsRemaining,
    this.currentMilestone,
  });

  final bool isTripStarted;
  final String truckLabel;

  /// A function that returns the short human-readable label for the driver's
  /// current position (matches the signature used in HomeScreen).
  final String currentLocationLabel;
  final String destinationAddress;
  final String distance;
  final String duration;
  final String payout;
  final VoidCallback onStartTrip;
  final VoidCallback onCompleteTrip;
  final VoidCallback onCancel;
  final VoidCallback onOpenMaps;
  /// Number of stops not yet completed (null = unknown).
  final int? stopsRemaining;
  /// Human-readable current milestone label (e.g. "arrived_pickup").
  final String? currentMilestone;

  /// Explicit status badge text (e.g. 'EN-ROUTE', 'LOADING', 'ASSIGNED LOAD').
  /// Falls back to the old isTripStarted logic when null.
  final String? statusLabel;

  /// Formatted ETA string, e.g. "ETA 3:42 PM" or "~25 min".
  /// Shown as a chip next to the status badge.
  final String? eta;

  /// Trip completion as a fraction [0.0 – 1.0].
  /// Drives the LinearProgressIndicator shown below the route line.
  /// If null the progress bar is hidden.
  final double? progressPercent;

  // ── Derived helpers ─────────────────────────────────────────────────────

  String get _resolvedStatus {
    if (statusLabel != null && statusLabel!.isNotEmpty) return statusLabel!;
    return isTripStarted ? 'EN-ROUTE' : 'ASSIGNED LOAD';
  }

  Color _statusBgColor(BuildContext context) {
    switch (_resolvedStatus) {
      case 'EN-ROUTE':
        return TruxifyColors.successLight;
      case 'LOADING':
        return Colors.amber.shade100;
      case 'DELIVERED':
        return Colors.blue.shade50;
      default:
        return TruxifyColors.accentLight;
    }
  }

  Color _statusFgColor(BuildContext context) {
    switch (_resolvedStatus) {
      case 'EN-ROUTE':
        return TruxifyColors.success;
      case 'LOADING':
        return Colors.amber.shade800;
      case 'DELIVERED':
        return Colors.blue.shade700;
      default:
        return TruxifyColors.accent;
    }
  }

  @override
  Widget build(BuildContext context) {
    final clampedProgress =
        (progressPercent ?? 0.0).clamp(0.0, 1.0).toDouble();
    final showProgress = progressPercent != null && isTripStarted;
    final progressPct = (clampedProgress * 100).toStringAsFixed(0);

    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.08),
            blurRadius: 20,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: const EdgeInsets.all(16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // ── Row 1: status badge + ETA + nav icon ──────────────────────
          Row(
            children: [
              // Status badge
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: _statusBgColor(context),
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  _resolvedStatus,
                  style: GoogleFonts.dmSans(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: _statusFgColor(context),
                  ),
                ),
              ),

              // ETA chip — only shown when provided and trip is started
              if (eta != null && eta!.isNotEmpty && isTripStarted) ...[
                const SizedBox(width: 8),
                Container(
                  padding:
                      const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? Theme.of(context).colorScheme.surfaceContainerHighest
                        : TruxifyColors.background,
                    borderRadius: BorderRadius.circular(6),
                    border: Border.all(color: TruxifyColors.border),
                  ),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(
                        Icons.schedule_rounded,
                        size: 10,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                      const SizedBox(width: 4),
                      Text(
                        eta!,
                        style: GoogleFonts.dmSans(
                          fontSize: 9,
                          fontWeight: FontWeight.w600,
                          color:
                              TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                    ],
                  ),
                ),
              ],

              const Spacer(),

              // Truck label
              Flexible(
                child: Text(
                  truckLabel,
                  overflow: TextOverflow.ellipsis,
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
                ),
              ),

              // Navigation icon
              IconButton(
                icon: const Icon(Icons.navigation_rounded),
                color: TruxifyColors.accent,
                onPressed: onOpenMaps,
                padding: EdgeInsets.zero,
                constraints: const BoxConstraints(),
              ),
            ],
          ),

          const SizedBox(height: 8),

          // ── Row 2: Origin → Destination ───────────────────────────────
          Text(
            '$currentLocationLabel → $destinationAddress',
            style: GoogleFonts.dmSans(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          // ── Milestone chip row (shown only when data is available) ──
          if (stopsRemaining != null || (currentMilestone != null && currentMilestone!.isNotEmpty)) ...[
            const SizedBox(height: 6),
            Row(
              children: [
                if (currentMilestone != null && currentMilestone!.isNotEmpty)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFF1A73E8).withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: const Color(0xFF1A73E8).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.flag_rounded,
                          size: 10,
                          color: Color(0xFF1A73E8),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          currentMilestone!.replaceAll('_', ' ').toUpperCase(),
                          style: GoogleFonts.dmSans(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFF1A73E8),
                            letterSpacing: 0.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                if (stopsRemaining != null) ...[
                  const SizedBox(width: 6),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                    decoration: BoxDecoration(
                      color: const Color(0xFFF59E0B).withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(20),
                      border: Border.all(
                        color: const Color(0xFFF59E0B).withValues(alpha: 0.3),
                      ),
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(
                          Icons.pin_drop_outlined,
                          size: 10,
                          color: Color(0xFFF59E0B),
                        ),
                        const SizedBox(width: 4),
                        Text(
                          '$stopsRemaining ${stopsRemaining == 1 ? 'stop' : 'stops'} left',
                          style: GoogleFonts.dmSans(
                            fontSize: 9,
                            fontWeight: FontWeight.bold,
                            color: const Color(0xFFF59E0B),
                            letterSpacing: 0.4,
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
              ],
            ),
          ],
          const SizedBox(height: 12),

          // ── Row 3: Distance / Duration / Payout specs ─────────────────
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              TripSpec(
                  label: 'Distance',
                  value: distance.isNotEmpty ? distance : '--'),
              TripSpec(
                  label: 'Est. Duration',
                  value: duration.isNotEmpty ? duration : '--'),
              TripSpec(
                  label: 'Est. Payout',
                  value: payout.isNotEmpty ? payout : '--'),
            ],
          ),

          const SizedBox(height: 16),

          // ── Action button ──────────────────────────────────────────────
          if (isTripStarted) ...[
            SlideToConfirmButton(
              label: 'Slide to Complete Trip',
              backgroundColor: TruxifyColors.success,
              onConfirmed: onCompleteTrip,
            ),
          ] else ...[
            SlideToConfirmButton(
              label: 'Slide to Start Trip',
              backgroundColor: TruxifyColors.accent,
              onConfirmed: onStartTrip,
            ),
            const SizedBox(height: 8),
            Center(
              child: InkWell(
                onTap: onCancel,
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 4),
                  child: Text(
                    'Cancel Assignment',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}