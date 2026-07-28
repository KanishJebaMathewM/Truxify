import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../../theme/app_theme.dart';

class LowBatteryBanner extends StatelessWidget {
  const LowBatteryBanner({
    super.key,
    required this.batteryLevel,
    this.isCritical = false,
  });

  final int batteryLevel;
  final bool isCritical;

  @override
  Widget build(BuildContext context) {
    final color = isCritical ? TruxifyColors.errorRed : TruxifyColors.warning;
    final icon = isCritical
        ? Icons.battery_alert_rounded
        : Icons.battery_warning_rounded;
    final text = isCritical
        ? 'Critical battery ($batteryLevel%). Connect charger immediately.'
        : 'Low battery ($batteryLevel%). Connect charger soon.';

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.symmetric(vertical: 8, horizontal: 16),
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: Colors.white, size: 16),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              text,
              textAlign: TextAlign.center,
              style: GoogleFonts.dmSans(
                color: Colors.white,
                fontSize: 13,
                fontWeight: FontWeight.w600,
              ),
            ),
          ),
        ],
      ),
    );
  }
}
