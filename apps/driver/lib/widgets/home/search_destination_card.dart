import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../models/app_models.dart';
import '../../theme/app_theme.dart';
import '../pulsing_location_dot.dart';

class SearchDestinationCard extends StatelessWidget {
  const SearchDestinationCard({
    super.key,
    required this.currentLocationText,
    required this.destination,
    required this.isLoadingLocation,
    required this.isRefreshingLocation,
    required this.locationError,
    required this.onRefreshLocation,
    required this.onOpenDestinationPicker,
  });

  final String? currentLocationText;
  final DestinationPickResult? destination;
  final bool isLoadingLocation;
  final bool isRefreshingLocation;
  final String? locationError;
  final VoidCallback onRefreshLocation;
  final VoidCallback onOpenDestinationPicker;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 18,
            offset: const Offset(0, 6),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(14, 8, 12, 8),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.center,
          children: [
            Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const PulsingLocationDot(),
                Container(width: 1, height: 12, color: TruxifyColors.border),
                const Icon(Icons.location_on_rounded,
                    size: 14, color: TruxifyColors.errorRed),
              ],
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  GestureDetector(
                    onTap: onRefreshLocation,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Row(
                        children: [
                          Expanded(
                            child: isLoadingLocation
                                ? Text(
                                    'Fetching your location...',
                                    style: GoogleFonts.dmSans(
                                      fontSize: 13,
                                      color:
                                          TruxifyColors.adaptiveSecondaryText(
                                              context),
                                    ),
                                  )
                                : locationError != null
                                    ? Text(
                                        locationError!,
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 13,
                                          color: TruxifyColors.errorRed,
                                        ),
                                      )
                                    : Text(
                                        currentLocationText ??
                                            'Tap to refresh location',
                                        maxLines: 1,
                                        overflow: TextOverflow.ellipsis,
                                        style: GoogleFonts.dmSans(
                                          fontSize: 13,
                                          fontWeight: FontWeight.w600,
                                          color: Theme.of(context)
                                              .colorScheme
                                              .onSurface,
                                        ),
                                      ),
                          ),
                          isRefreshingLocation || isLoadingLocation
                              ? const SizedBox(
                                  width: 14,
                                  height: 14,
                                  child: CircularProgressIndicator(
                                    strokeWidth: 1.5,
                                    color: TruxifyColors.accent,
                                  ),
                                )
                              : Icon(
                                  locationError != null
                                      ? Icons.error_outline_rounded
                                      : Icons.refresh_rounded,
                                  size: 16,
                                  color: locationError != null
                                      ? TruxifyColors.errorRed
                                      : TruxifyColors.adaptiveSecondaryText(
                                          context),
                                ),
                        ],
                      ),
                    ),
                  ),
                  const Divider(height: 12, color: TruxifyColors.border),
                  GestureDetector(
                    onTap: onOpenDestinationPicker,
                    child: Container(
                      width: double.infinity,
                      padding: const EdgeInsets.symmetric(vertical: 4),
                      child: Text(
                        destination?.address ?? 'Where are you heading?',
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: destination == null
                              ? FontWeight.normal
                              : FontWeight.w600,
                          color: destination == null
                              ? TruxifyColors.hintText
                              : TruxifyColors.primaryText,
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
