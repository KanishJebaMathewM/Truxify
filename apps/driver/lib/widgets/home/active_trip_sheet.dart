import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../theme/app_theme.dart';
import '../slide_to_confirm_button.dart';
import 'trip_spec.dart';

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
  });

  final bool isTripStarted;
  final String truckLabel;
  final String currentLocationLabel;
  final String destinationAddress;
  final String distance;
  final String duration;
  final String payout;
  final VoidCallback onStartTrip;
  final VoidCallback onCompleteTrip;
  final VoidCallback onCancel;
  final VoidCallback onOpenMaps;

  @override
  Widget build(BuildContext context) {
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
          Row(
            children: [
              Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: isTripStarted
                      ? TruxifyColors.successLight
                      : TruxifyColors.accentLight,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  isTripStarted ? 'EN-ROUTE' : 'ASSIGNED LOAD',
                  style: GoogleFonts.dmSans(
                    fontSize: 9,
                    fontWeight: FontWeight.bold,
                    color: isTripStarted
                        ? TruxifyColors.success
                        : TruxifyColors.accent,
                  ),
                ),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  truckLabel,
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
                ),
              ),
              IconButton(
                icon: const Icon(Icons.navigation_rounded),
                color: TruxifyColors.accent,
                onPressed: onOpenMaps,
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            '$currentLocationLabel → $destinationAddress',
            style: GoogleFonts.dmSans(
              fontSize: 15,
              fontWeight: FontWeight.bold,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const SizedBox(height: 12),
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
