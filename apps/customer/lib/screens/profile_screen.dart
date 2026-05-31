import 'package:flutter/material.dart';

import '../controllers/app_controller.dart';
import '../theme/app_theme.dart';
import '../widgets/app_page_route.dart';
import 'about_screen.dart';
import 'edit_profile_screen.dart';
import 'help_support_screen.dart';
import 'language_screen.dart';
import 'login_screen.dart';
import 'my_documents_screen.dart';
import 'payment_methods_screen.dart';
import 'saved_addresses_screen.dart';

class ProfileScreen extends StatelessWidget {
  const ProfileScreen({super.key});

  static const _profileName = 'Karthik Murugan';
  static const _companyName = 'Sri Murugan Textiles';
  static const _phoneNumber = '+91 98765 43210';

  void _logout(BuildContext context) {
    Navigator.of(context).pushAndRemoveUntil(
      AppPageRoute(builder: (_) => const LoginScreen()),
      (route) => false,
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Stack(
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.fromLTRB(20, 20, 20, 32),
                  decoration: const BoxDecoration(
                    color: TruxifyColors.accent,
                  ),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Container(
                        width: 72,
                        height: 72,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white.withValues(alpha: 0.4), width: 3),
                        ),
                        alignment: Alignment.center,
                        child: const Text(
                          'KM',
                          style: TextStyle(
                            fontSize: 22,
                            fontWeight: FontWeight.w500,
                            color: TruxifyColors.accent,
                          ),
                        ),
                      ),
                      const SizedBox(height: 12),
                      Text(
                        _profileName,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _companyName,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Colors.white.withValues(alpha: 0.75),
                              fontSize: 13,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _phoneNumber,
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(
                              color: Colors.white.withValues(alpha: 0.6),
                              fontSize: 12,
                            ),
                      ),
                    ],
                  ),
                ),
                Positioned(
                  top: 20,
                  right: 20,
                  child: IconButton(
                    onPressed: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const EditProfileScreen())),
                    icon: const Icon(Icons.edit_rounded, color: Colors.white, size: 24),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    splashRadius: 20,
                  ),
                ),
              ],
            ),
            Transform.translate(
              offset: const Offset(0, -18),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _StatsCard(),
              ),
            ),
            const SizedBox(height: 10),
            _SectionLabel(text: 'Account', padding: const EdgeInsets.symmetric(horizontal: 16)),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _MenuCard(
                children: [
                  _MenuItem(
                    icon: Icons.credit_card_rounded,
                    label: 'Payment Methods',
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const PaymentMethodsScreen())),
                  ),
                  _MenuItem(
                    icon: Icons.description_rounded,
                    label: 'My Documents',
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const MyDocumentsScreen())),
                  ),
                  _MenuItem(
                    icon: Icons.location_on_rounded,
                    label: 'Saved Addresses',
                    showDivider: false,
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const SavedAddressesScreen())),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _SectionLabel(text: 'Preferences', padding: const EdgeInsets.symmetric(horizontal: 16)),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _MenuCard(
                children: [
                  _DarkModeMenuItem(),
                  _MenuItem(
                    icon: Icons.language_rounded,
                    label: 'Language',
                    trailing: 'English',
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const LanguageScreen())),
                  ),
                  _MenuItem(
                    icon: Icons.help_outline_rounded,
                    label: 'Help & Support',
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const HelpSupportScreen())),
                  ),
                  _MenuItem(
                    icon: Icons.info_outline_rounded,
                    label: 'About Truxify',
                    showDivider: false,
                    onTap: () => Navigator.of(context).push(AppPageRoute(builder: (_) => const AboutScreen())),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: _MenuCard(
                children: [
                  _MenuItem(
                    icon: Icons.logout_rounded,
                    label: 'Logout',
                    iconBackgroundColor: TruxifyColors.error.withValues(alpha: 0.12),
                    iconColor: TruxifyColors.error,
                    textColor: TruxifyColors.error,
                    showChevron: false,
                    showDivider: false,
                    onTap: () => _logout(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
          ],
        ),
      ),
    );
  }
}

class _SectionLabel extends StatelessWidget {
  const _SectionLabel({required this.text, this.padding = EdgeInsets.zero});

  final String text;
  final EdgeInsetsGeometry padding;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: padding,
      child: Text(
        text.toUpperCase(),
        style: Theme.of(context).textTheme.labelSmall?.copyWith(
              color: TruxifyColors.adaptiveSecondaryText(context),
              fontSize: 11,
              letterSpacing: 0.06 * 11,
              fontWeight: FontWeight.w500,
            ),
      ),
    );
  }
}

class _StatsCard extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;
    final dividerColor = (Theme.of(context).brightness == Brightness.dark ? TruxifyColors.darkBorder : TruxifyColors.border);
    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      child: Row(
        children: [
          Expanded(
            child: _StatColumn(
              value: '28',
              label: 'Orders',
              valueSize: 20,
              addRightDivider: true,
              dividerColor: dividerColor,
            ),
          ),
          Expanded(
            child: _StatColumn(
              value: '₹42.8k',
              label: 'Saved',
              valueSize: 16,
              addRightDivider: true,
              dividerColor: dividerColor,
            ),
          ),
          Expanded(
            child: _StatColumn(
              value: '124',
              label: 'kg CO2',
              valueSize: 20,
              dividerColor: dividerColor,
            ),
          ),
        ],
      ),
    );
  }
}

class _StatColumn extends StatelessWidget {
  const _StatColumn({
    required this.value,
    required this.label,
    required this.valueSize,
    this.addRightDivider = false,
    this.dividerColor = TruxifyColors.border,
  });

  final String value;
  final String label;
  final double valueSize;
  final bool addRightDivider;
  final Color dividerColor;

  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        border: addRightDivider ? Border(right: BorderSide(color: dividerColor)) : null,
      ),
      padding: const EdgeInsets.symmetric(horizontal: 8),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            value,
            style: Theme.of(context).textTheme.titleMedium?.copyWith(
                  color: TruxifyColors.accent,
                  fontWeight: FontWeight.w500,
                  fontSize: valueSize,
                ),
          ),
          const SizedBox(height: 2),
          Text(
            label,
            style: Theme.of(context).textTheme.labelSmall?.copyWith(
                  color: TruxifyColors.adaptiveSecondaryText(context),
                  fontSize: 11,
                ),
          ),
        ],
      ),
    );
  }
}

class _MenuCard extends StatelessWidget {
  const _MenuCard({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;
    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(color: Color(0x0F000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      child: Column(children: children),
    );
  }
}

class _MenuItem extends StatelessWidget {
  const _MenuItem({
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
        (isDark ? TruxifyColors.darkAccentLight : TruxifyColors.accentLight);
    final resolvedTextColor = textColor ?? Theme.of(context).textTheme.bodyMedium?.color;
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
                    color: isDark ? TruxifyColors.darkSecondaryText : const Color(0xFFB0B0B0),
                  ),
              ],
            ),
          ),
          if (showDivider)
            Divider(
              height: 1,
              thickness: 1,
              color: isDark ? TruxifyColors.darkBorder : TruxifyColors.border,
            ),
        ],
      ),
    );
  }
}

class _DarkModeMenuItem extends StatelessWidget {
  const _DarkModeMenuItem();

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);
    final isDark = controller.isDarkMode;
    final iconBg = isDark ? TruxifyColors.darkAccentLight : TruxifyColors.accentLight;
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          child: Row(
            children: [
              Container(
                width: 34,
                height: 34,
                decoration: BoxDecoration(
                  color: iconBg,
                  borderRadius: BorderRadius.circular(10),
                ),
                child: const Icon(Icons.dark_mode_rounded, size: 17, color: TruxifyColors.accent),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Dark Mode',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                        fontSize: 14,
                      ),
                ),
              ),
              Switch(
                value: isDark,
                onChanged: (_) => controller.toggleDarkMode(),
                activeThumbColor: TruxifyColors.accent,
              ),
            ],
          ),
        ),
        Divider(
          height: 1,
          thickness: 1,
          color: isDark ? TruxifyColors.darkBorder : TruxifyColors.border,
        ),
      ],
    );
  }
}
