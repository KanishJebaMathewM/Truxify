import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:http/http.dart' as http;
import '../controllers/app_controller.dart';
import '../core/app_routes.dart';
import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/fcm_service.dart';
import '../../core/supabase_config.dart';
import 'package:truxify_shared/truxify_shared.dart' hide NotificationsScreen;
import 'notifications_screen.dart';

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
  String _walletAddress = '';

  @override
  void initState() {
    super.initState();
    _loadWalletAddress();
    _fetchReputation();
  }

  static const String _apiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  double? _supabaseRating;
  int? _onChainScore;
  bool _reputationUnavailable = false;

  Future<void> _loadWalletAddress() async {
    try {
      final client = Supabase.instance.client;
      final userId = client.auth.currentUser?.id;
      if (userId != null) {
        final data = await client
            .from('profiles')
            .select('wallet_address')
            .eq('id', userId)
            .maybeSingle();
        if (data != null && mounted) {
          setState(() {
            _walletAddress = data['wallet_address']?.toString() ?? '';
          });
        }
      }
    } catch (e) {
      debugPrint('Failed to load wallet address: $e');
    }
  }

  Future<void> _fetchReputation() async {
    try {
      final client = Supabase.instance.client;
      final userId = client.auth.currentUser?.id;
      final token = client.auth.currentSession?.accessToken;
      
      if (userId == null) return;
      
      final response = await http.get(
        Uri.parse(
          '$_apiBaseUrl/api/driver/$userId/reputation',
        ),
        headers: {
          if (token != null) 'Authorization': 'Bearer $token',
          'x-user-id': userId,
          'x-user-role': 'driver',
        },
      );
      
      if (response.statusCode == 200) {
        final data = jsonDecode(response.body);
        
        if (!mounted) return;
        
        setState(() {
          _supabaseRating =
            (data['supabaseRating'] as num?)?.toDouble();

          _onChainScore = int.tryParse(
            data['onChainScore']?.toString() ?? '',
          );
            
          _reputationUnavailable = false;
        });
      } else {
        if (!mounted) return;

        setState(() {
          _reputationUnavailable = true;
        });
      }
    } catch (_) {
      if (!mounted) return;
      
      setState(() {
        _reputationUnavailable = true;
      });
    }
  }

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

  Future<void> _showWalletSheet(BuildContext context) async {
    final walletController = TextEditingController(text: _walletAddress);

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
                'Polygon Wallet Address',
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              if (_walletAddress.isNotEmpty)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: Container(
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: TruxifyColors.accentLight,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Row(
                      children: [
                        const Icon(Icons.check_circle_rounded,
                            color: TruxifyColors.success, size: 16),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            _walletAddress,
                            style: GoogleFonts.robotoMono(
                              fontSize: 12,
                              color: TruxifyColors.accentDark,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              TextField(
                controller: walletController,
                style: GoogleFonts.robotoMono(
                    fontSize: 13,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: '0x...',
                  hintText: '0x1234567890abcdef1234567890abcdef12345678',
                  labelStyle: GoogleFonts.robotoMono(
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
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Save Wallet Address',
                onPressed: () async {
                  final address = walletController.text.trim();
                  if (address.isEmpty) return;
                  try {
                    final client = Supabase.instance.client;
                    final token = client.auth.currentSession?.accessToken;
                    final userId = client.auth.currentUser?.id ?? '';
                    final response = await http.put(
                      Uri.parse('http://localhost:5000/api/profile/wallet'),
                      headers: <String, String>{
                        'Content-Type': 'application/json',
                        if (token != null) 'Authorization': 'Bearer $token',
                        'x-user-id': userId,
                        'x-user-role': 'driver',
                      },
                      body: jsonEncode(<String, String>{
                        'wallet_address': address,
                      }),
                    );
                    if (response.statusCode == 200) {
                      setState(() {
                        _walletAddress = address;
                      });
                      Navigator.of(context).pop();
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content:
                                Text('Wallet address updated successfully'),
                            backgroundColor: TruxifyColors.success,
                          ),
                        );
                      }
                    } else {
                      final body = jsonDecode(response.body)
                          as Map<String, dynamic>;
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(body['error']?.toString() ??
                                'Failed to update wallet'),
                            backgroundColor: TruxifyColors.errorRed,
                          ),
                        );
                      }
                    }
                  } catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text('Error: $e'),
                          backgroundColor: TruxifyColors.errorRed,
                        ),
                      );
                    }
                  }
                },
              ),
            ],
          ),
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
                icon: Icons.help_outline_rounded,
                title: 'Browse FAQs',
                subtitle: 'Instant answers to common driver questions',
                color: TruxifyColors.hintText,
                onTap: () {
                  Navigator.pop(context);
                  Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => _DriverHelpScreen(),
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

          const SizedBox(height: 16),

AppCard(
  padding: const EdgeInsets.all(16),
  child: Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Text(
        'Reputation',
        style: GoogleFonts.dmSans(
          fontSize: 16,
          fontWeight: FontWeight.bold,
          color: Theme.of(context).colorScheme.onSurface,
        ),
      ),
      const SizedBox(height: 12),

      if (_reputationUnavailable)
        Text(
          'Unable to fetch reputation.',
          style: GoogleFonts.dmSans(
            color: TruxifyColors.errorRed,
          ),
        )
      else
        Row(
          children: [
            Expanded(
              child: _MetricColumn(
                label: 'Supabase Rating',
                value: _supabaseRating?.toStringAsFixed(1) ?? '--',
              ),
            ),
            Container(
              width: 1,
              height: 32,
              color: _borderColor(context),
            ),
            Expanded(
              child: _MetricColumn(
                label: 'On-chain Score',
                value: _onChainScore?.toString() ?? '--',
              ),
            ),
          ],
        ),
    ],
  ),
),

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
                    'Notifications',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    'View trip alerts and updates',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute(
                      builder: (_) => const NotificationsScreen(),
                    ),
                  ),
                ),
                Divider(
                  height: 1,
                  color: _borderColor(context),
                ),
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    'Wallet Address',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    _walletAddress.isNotEmpty
                        ? '${_walletAddress.substring(0, 10)}...${_walletAddress.substring(_walletAddress.length - 6)}'
                        : 'Not set',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      color: TruxifyColors.adaptiveSecondaryText(context),
                    ),
                  ),
                  trailing: Icon(Icons.chevron_right_rounded,
                      color: TruxifyColors.adaptiveSecondaryText(context)),
                  onTap: () => _showWalletSheet(context),
                ),
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
            onTap: () async {
              try {
                if (SupabaseConfig.isConfigured) {
                  final client = Supabase.instance.client;
                  final session = client.auth.currentSession;
                  final accessToken = session?.accessToken;
                  final driverId = client.auth.currentUser?.id;

                  if (accessToken != null && driverId != null) {
                    const apiBaseUrl = String.fromEnvironment(
                      'TRUXIFY_API_BASE_URL',
                      defaultValue: 'http://localhost:5000',
                    );
                    try {
                      await http.post(
                        Uri.parse('$apiBaseUrl/api/auth/logout'),
                        headers: <String, String>{
                          'Content-Type': 'application/json',
                          'Authorization': 'Bearer $accessToken',
                          'x-user-id': driverId,
                          'x-user-role': 'driver',
                        },
                      ).timeout(const Duration(seconds: 5));
                    } catch (e) {
                      debugPrint('Backend logout failed: $e');
                    }
                  }

                  // Clear FCM token on logout
                  await FcmService.clearToken();

                  await client.auth.signOut();
                }

                if (!context.mounted) {
                  return;
                }

                // Logout lives inside the profile tab's nested navigator, so we
                // must clear the root stack to remove the authenticated shell.
                Navigator.of(context, rootNavigator: true)
                    .pushNamedAndRemoveUntil(
                  AppRoutes.login,
                  (route) => false,
                );
              } catch (e) {
                if (context.mounted) {
                  ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('Logout failed: $e')),
                  );
                }
              }
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

class _DriverHelpScreen extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    final client = Supabase.instance.client;
    final userId = client.auth.currentUser?.id;
    return HelpCenterScreen(
      appType: 'driver',
      userId: userId,
      faqRepository: FaqRepository(client),
      supportRepository: SupportRepository(client),
      title: 'Help & Support',
    );
  }
}

class _ThemeModeTile extends StatelessWidget {
  const _ThemeModeTile();

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);
    final currentTheme = controller.themeMode;
    final selectedTheme = currentTheme == ThemeMode.system
        ? (Theme.of(context).brightness == Brightness.dark
            ? ThemeMode.dark
            : ThemeMode.light)
        : currentTheme;

    return Padding(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      child: Row(
        children: [
          Text(
            'Theme',
            style: GoogleFonts.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          const Spacer(),
          SegmentedButton<ThemeMode>(
            showSelectedIcon: false,
            style: ButtonStyle(
              visualDensity: VisualDensity.compact,
              padding: WidgetStateProperty.all(
                const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
              ),
            ),
            segments: const [
              ButtonSegment<ThemeMode>(
                value: ThemeMode.light,
                label: Text('Light'),
              ),
              ButtonSegment<ThemeMode>(
                value: ThemeMode.dark,
                label: Text('Dark'),
              ),
            ],
            selected: {selectedTheme},
            onSelectionChanged: (selection) {
              controller.setThemeMode(selection.first);
            },
          ),
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
