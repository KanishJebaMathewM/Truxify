import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../core/app_routes.dart';
import '../../models/app_models.dart';
import '../../theme/app_theme.dart';

class NewLoadNotificationBanner extends StatelessWidget {
  const NewLoadNotificationBanner({
    super.key,
    required this.load,
    required this.onView,
    required this.onDismiss,
  });

  final LoadOffer load;
  final VoidCallback onView;
  final VoidCallback onDismiss;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: () {
        onDismiss();
        Navigator.of(context).pushNamed(
          AppRoutes.loadDetail,
          arguments: load,
        );
      },
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
        decoration: BoxDecoration(
          color: TruxifyColors.accent,
          borderRadius: BorderRadius.circular(14),
          boxShadow: [
            BoxShadow(
              color: TruxifyColors.accent.withValues(alpha: 0.25),
              blurRadius: 12,
              offset: const Offset(0, 4),
            ),
          ],
        ),
        child: Row(
          children: [
            const Icon(Icons.local_shipping_rounded,
                color: Colors.white, size: 18),
            const SizedBox(width: 10),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                mainAxisSize: MainAxisSize.min,
                children: [
                  Text(
                    'New Load Available!',
                    style: GoogleFonts.dmSans(
                      fontSize: 13,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    load.route,
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.dmSans(
                      fontSize: 11,
                      fontWeight: FontWeight.w500,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 1),
                  Text(
                    '${load.weight != '—' ? '${load.weight} ' : ''}${load.goods} • ${load.estimatedProfit}',
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                    style: GoogleFonts.dmSans(
                      fontSize: 10,
                      color: Colors.white.withValues(alpha: 0.85),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(width: 10),
            GestureDetector(
              key: const Key('realtime_notification_view_button'),
              onTap: () {
                onDismiss();
                Navigator.of(context).pushNamed(
                  AppRoutes.loadDetail,
                  arguments: load,
                );
              },
              child: Container(
                padding:
                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Text(
                  'View',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.accent,
                  ),
                ),
              ),
            ),
            const SizedBox(width: 10),
            GestureDetector(
              key: const Key('realtime_notification_close_button'),
              onTap: onDismiss,
              child: Icon(
                Icons.close_rounded,
                color: Colors.white.withValues(alpha: 0.7),
                size: 20,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
