import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({
    super.key,
    this.onOpenDocuments,
    this.onSelectTab,
  });

  final VoidCallback? onOpenDocuments;
  final ValueChanged<int>? onSelectTab;

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  String _driverName = driverName;
  String _driverPhone = '+91 98765 43210';
  String _driverEmail = 'kanish.jeba@truxify.com';
  String _currentLanguage = 'English';

  Color _borderColor(BuildContext context) {
    return Theme.of(context).brightness == Brightness.dark
        ? TruxifyColors.darkBorder
        : TruxifyColors.border;
  }

  Future<void> _showEditProfileSheet(BuildContext context) async {
    final nameController = TextEditingController(text: _driverName);
    final phoneController = TextEditingController(text: _driverPhone);
    final emailController = TextEditingController(text: _driverEmail);

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.fromLTRB(
              20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Text(
                'Edit Profile',
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              TextField(
                controller: nameController,
                style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: 'Full Name',
                  labelStyle: GoogleFonts.dmSans(
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: _borderColor(context),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: TruxifyColors.accent),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: phoneController,
                style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: 'Phone Number',
                  labelStyle: GoogleFonts.dmSans(
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: _borderColor(context),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: TruxifyColors.accent),
                  ),
                ),
                keyboardType: TextInputType.phone,
              ),
              const SizedBox(height: 12),
              TextField(
                controller: emailController,
                style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: 'Email Address',
                  labelStyle: GoogleFonts.dmSans(
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: BorderSide(
                      color: _borderColor(context),
                    ),
                  ),
                  focusedBorder: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                    borderSide: const BorderSide(color: TruxifyColors.accent),
                  ),
                ),
                keyboardType: TextInputType.emailAddress,
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Save Changes',
                onPressed: () {
                  setState(() {
                    _driverName = nameController.text.trim();
                    _driverPhone = phoneController.text.trim();
                    _driverEmail = emailController.text.trim();
                  });
                  Navigator.of(context).pop();
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                      content: Text('Profile updated successfully'),
                      backgroundColor: TruxifyColors.success,
                    ),
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showLanguageSheet(BuildContext context) async {
    String selectedLang = _currentLanguage;
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const BottomSheetHandle(),
                  const SizedBox(height: 16),
                  Text(
                    'Select Language',
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 16),
                  ...['English', 'Hindi (हिंदी)', 'Gujarati (ગુજરાતી)']
                      .map((lang) {
                    final isSelected = lang.startsWith(selectedLang);
                    return GestureDetector(
                      onTap: () {
                        setSheetState(() => selectedLang = lang.split(' ')[0]);
                      },
                      child: Container(
                        margin: const EdgeInsets.only(bottom: 8),
                        padding: const EdgeInsets.all(14),
                        decoration: BoxDecoration(
                          color: isSelected
                              ? TruxifyColors.accentLight
                              : Colors.grey.shade50,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(
                            color: isSelected
                                ? TruxifyColors.accent
                                : Colors.grey.shade200,
                          ),
                        ),
                        child: Row(
                          mainAxisAlignment: MainAxisAlignment.spaceBetween,
                          children: [
                            Text(
                              lang,
                              style: GoogleFonts.dmSans(
                                fontSize: 14,
                                fontWeight: isSelected
                                    ? FontWeight.bold
                                    : FontWeight.normal,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            ),
                            if (isSelected)
                              const Icon(Icons.check_circle_rounded,
                                  color: TruxifyColors.accent),
                          ],
                        ),
                      ),
                    );
                  }),
                  const SizedBox(height: 16),
                  PrimaryButton(
                    label: 'Apply Language',
                    onPressed: () {
                      setState(() {
                        _currentLanguage = selectedLang;
                      });
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content:
                              Text('Language switched to $_currentLanguage'),
                          backgroundColor: TruxifyColors.success,
                        ),
                      );
                    },
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showHelpSheet(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Text(
                'Help & Support',
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              _buildHelpOption(
                icon: Icons.phone_in_talk_rounded,
                title: 'Call Support Hotline',
                subtitle: 'Direct connection to 24/7 emergency dispatch',
                color: TruxifyColors.success,
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text(
                            'Calling support hotline at +91 1800-TRUXIFY...')),
                  );
                },
              ),
              const SizedBox(height: 10),
              _buildHelpOption(
                icon: Icons.chat_bubble_outline_rounded,
                title: 'Live Chat Assistant',
                subtitle: 'Chat directly with support representatives',
                color: TruxifyColors.accent,
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content:
                            Text('Connecting to Truxify support agent...')),
                  );
                },
              ),
              const SizedBox(height: 10),
              _buildHelpOption(
                icon: Icons.help_outline_rounded,
                title: 'Browse FAQs',
                subtitle: 'Instant answers to common driver questions',
                color: TruxifyColors.hintText,
                onTap: () {
                  Navigator.pop(context);
                  ScaffoldMessenger.of(context).showSnackBar(
                    const SnackBar(
                        content: Text('Opening help center database...')),
                  );
                },
              ),
            ],
          ),
        );
      },
    );
  }

  Widget _buildHelpOption({
    required IconData icon,
    required String title,
    required String subtitle,
    required Color color,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          border: Border.all(
            color: _borderColor(context),
          ),
          borderRadius: BorderRadius.circular(12),
        ),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: color.withOpacity(0.1),
                shape: BoxShape.circle,
              ),
              child: Icon(icon, color: color, size: 20),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  const SizedBox(height: 2),
                  Text(
                    subtitle,
                    style: GoogleFonts.dmSans(
                      fontSize: 11,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                ],
              ),
            ),
            const Icon(Icons.chevron_right_rounded,
                color: TruxifyColors.hintText),
          ],
        ),
      ),
    );
  }

  Future<void> _showAboutSheet(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 20),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Container(
                width: 60,
                height: 60,
                decoration: BoxDecoration(
                  color: TruxifyColors.accentLight,
                  shape: BoxShape.circle,
                ),
                child: const Center(
                  child: Icon(Icons.local_shipping_rounded,
                      color: TruxifyColors.accentDark, size: 32),
                ),
              ),
              const SizedBox(height: 12),
              Text(
                'Truxify Driver App',
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              Text(
                'v2.1.0-driver-prod',
                style: GoogleFonts.robotoMono(
                  fontSize: 12,
                  color: TruxifyColors.hintText,
                ),
              ),
              const SizedBox(height: 16),
              Text(
                'Truxify is a driver-first freight marketplace designed to empower drivers with transparent pricing, instant blockchain receipts, and direct loading solutions.',
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Close',
                onPressed: () => Navigator.pop(context),
              ),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 110),
        children: [
          // Header - Premium Gradient Card
          Container(
            decoration: BoxDecoration(
              gradient: const LinearGradient(
                colors: [TruxifyColors.accent, TruxifyColors.accentDark],
                begin: Alignment.topLeft,
                end: Alignment.bottomRight,
              ),
              borderRadius: BorderRadius.circular(16),
              boxShadow: [
                BoxShadow(
                  color: TruxifyColors.accent.withOpacity(0.15),
                  blurRadius: 10,
                  offset: const Offset(0, 4),
                ),
              ],
            ),
            padding: const EdgeInsets.all(20),
            child: Row(
              children: [
                Container(
                  decoration: BoxDecoration(
                    shape: BoxShape.circle,
                    border: Border.all(
                        color: Colors.white.withOpacity(0.2), width: 3),
                  ),
                  child: CircleAvatar(
                    radius: 30,
                    backgroundColor: Theme.of(context).colorScheme.surface,
                    child: Text(
                      _driverName.isNotEmpty
                          ? _driverName.substring(0, 1) +
                              (_driverName.contains(' ')
                                  ? _driverName.split(' ')[1].substring(0, 1)
                                  : '')
                          : 'JD',
                      style: GoogleFonts.dmSans(
                        fontSize: 20,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.accentDark,
                      ),
                    ),
                  ),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        _driverName,
                        style: GoogleFonts.dmSans(
                          fontSize: 18,
                          fontWeight: FontWeight.bold,
                          color: Colors.white,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        '$driverTruck · $driverTruckNumber',
                        style: GoogleFonts.dmSans(
                          fontSize: 12,
                          color: Colors.white.withOpacity(0.85),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.white.withOpacity(0.15),
                          borderRadius: BorderRadius.circular(12),
                        ),
                        child: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            const Icon(Icons.star_rounded,
                                color: Colors.amber, size: 14),
                            const SizedBox(width: 4),
                            Text(
                              '$driverRating · $driverTrips trips',
                              style: GoogleFonts.dmSans(
                                fontSize: 10,
                                fontWeight: FontWeight.w600,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
                IconButton(
                  onPressed: () => _showEditProfileSheet(context),
                  icon: const Icon(Icons.edit_rounded, color: Colors.white),
                  tooltip: 'Edit Profile',
                ),
              ],
            ),
          ),

          const SizedBox(height: 12),

          // Metrics
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
            child: Row(
              children: [
                Expanded(
                  child: _MetricColumn(
                    label: 'Earned',
                    value: driverEarningsMonth,
                  ),
                ),
                Container(
                  width: 1,
                  height: 32,
                  color: _borderColor(context),
                ),
                Expanded(
                  child: _MetricColumn(
                    label: 'Total Trips',
                    value: driverTrips,
                  ),
                ),
                Container(
                  width: 1,
                  height: 32,
                  color: _borderColor(context),
                ),
                Expanded(
                  child: _MetricColumn(
                    label: 'Completion Rate',
                    value: driverCompletion,
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          const SectionLabel(label: 'SETTINGS'),
          AppCard(
            child: Column(
              children: [
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    'Documents',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    'Driver license, permit, and vehicle papers',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => widget.onOpenDocuments?.call(),
                ),
                Divider(
                  height: 1,
                  color: _borderColor(context),
                ),
                const _ThemeModeTile(),
                Divider(
                  height: 1,
                  color: _borderColor(context),
                ),
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    'Language',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    _currentLanguage,
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => _showLanguageSheet(context),
                ),
                Divider(
                  height: 1,
                  color: _borderColor(context),
                ),
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    'Help & Support',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    '24/7 hotline, chat assistant, and FAQs',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => _showHelpSheet(context),
                ),
                Divider(
                  height: 1,
                  color: _borderColor(context),
                ),
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    'About Truxify',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    'Version and application info',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => _showAboutSheet(context),
                ),
              ],
            ),
          ),

          const SizedBox(height: 18),
          AppCard(
            onTap: () {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(
                  content: Text('Logged out successfully'),
                  backgroundColor: TruxifyColors.success,
                ),
              );
            },
            child: Row(
              children: [
                const Icon(Icons.logout_rounded, color: TruxifyColors.error),
                const SizedBox(width: 12),
                Text(
                  'Logout',
                  style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: TruxifyColors.error,
                    fontWeight: FontWeight.w600,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _ThemeModeTile extends StatelessWidget {
  const _ThemeModeTile();

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);
    final currentTheme = controller.themeMode;

    return ListTile(
      contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
      title: Text(
        'Theme',
        style: GoogleFonts.dmSans(
          fontSize: 14,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.onSurface,
        ),
      ),
      subtitle: Text(
        currentTheme.name[0].toUpperCase() + currentTheme.name.substring(1),
        style: GoogleFonts.dmSans(
          fontSize: 12,
          color: TruxifyColors.adaptiveSecondaryText(context),
        ),
      ),
      trailing: PopupMenuButton<ThemeMode>(
        onSelected: controller.setThemeMode,
        icon: Icon(
          Icons.keyboard_arrow_down_rounded,
          color: TruxifyColors.adaptiveSecondaryText(context),
        ),
        itemBuilder: (context) => const [
          PopupMenuItem(value: ThemeMode.system, child: Text('System')),
          PopupMenuItem(value: ThemeMode.light, child: Text('Light')),
          PopupMenuItem(value: ThemeMode.dark, child: Text('Dark')),
        ],
      ),
    );
  }
}

class _MetricColumn extends StatelessWidget {
  const _MetricColumn({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: GoogleFonts.dmSans(
            fontSize: 18,
            color: Theme.of(context).colorScheme.onSurface,
            fontWeight: FontWeight.bold,
          ),
        ),
        const SizedBox(height: 4),
        Text(
          label,
          textAlign: TextAlign.center,
          style: GoogleFonts.dmSans(
            fontSize: 11,
            color: TruxifyColors.adaptiveSecondaryText(context),
          ),
        ),
      ],
    );
  }
}
