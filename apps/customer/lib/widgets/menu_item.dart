import 'package:flutter/material.dart';
import '../theme/app_theme.dart';

class MenuItem extends StatelessWidget {
  const MenuItem({
    super.key,
    required this.icon,
    required this.label,
    required this.onTap,
    this.trailing,
    this.iconBackgroundColor,
    this.iconColor = TruxifyColors.accent,
    this.textColor,
    this.showChevron = true,
    this.showDivider = true,
  });

  final IconData icon;
  final String label;
  final VoidCallback onTap;
  final String? trailing;
  final Color? iconBackgroundColor;
  final Color iconColor;
  final Color? textColor;
  final bool showChevron;
  final bool showDivider;

  @override
  Widget build(BuildContext context) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    final resolvedIconBg = iconBackgroundColor ??
        (isDark
            ? TruxifyColors.darkAccentLight
            : TruxifyColors.accentLight);
    final resolvedTextColor =
        textColor ?? Theme.of(context).textTheme.bodyMedium?.color;
    return InkWell(
      onTap: onTap,
      child: Column(
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
            child: Row(
              children: [
                Container(
                  width: 34,
                  height: 34,
                  decoration: BoxDecoration(
                    color: resolvedIconBg,
                    borderRadius: BorderRadius.circular(10),
                  ),
                  child: Icon(icon, size: 17, color: iconColor),
                ),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    label,
                    style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                          color: resolvedTextColor,
                          fontWeight: FontWeight.w500,
                          fontSize: 14,
                        ),
                  ),
                ),
                if (trailing != null)
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: Text(
                      trailing!,
                      style: Theme.of(context).textTheme.bodySmall?.copyWith(
                            color: isDark
                                ? TruxifyColors.darkSecondaryText
                                : TruxifyColors.secondaryText,
                            fontSize: 13,
                          ),
                    ),
                  ),
                if (showChevron)
                  Icon(
                    Icons.chevron_right_rounded,
                    size: 16,
                    color: isDark
                        ? TruxifyColors.darkSecondaryText
                        : const Color(0xFFB0B0B0),
                  ),
              ],
            ),
          ),
          if (showDivider)
            Divider(
              height: 1,
              thickness: 1,
              color: isDark
                  ? TruxifyColors.darkBorder
                  : TruxifyColors.border,
            ),
        ],
      ),
    );
  }
}