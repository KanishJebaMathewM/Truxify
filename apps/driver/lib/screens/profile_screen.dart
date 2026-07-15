import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../controllers/app_controller.dart';
import '../core/app_routes.dart';
import '../core/config.dart';
import '../data/mock_data.dart';
import '../l10n/app_localizations.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import '../services/fcm_service.dart';
import '../core/supabase_config.dart';
import 'package:truxify_shared/truxify_shared.dart' hide NotificationsScreen;
import 'notifications_screen.dart';
import '../utils/validators.dart';

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
  String _driverName = '';
  String _driverPhone = '';
  String _driverEmail = '';
  String _currentLanguage = 'English';
  String _walletAddress = '';
  String _truckNumber = '';

  bool _isLoadingReputation = true;
  double? _platformRating;
  int? _onChainScore;
  bool _reputationUnavailable = false;

  @override
  void initState() {
    super.initState();
    _loadWalletAddress();
    _fetchReputation();
  }

  @override
  void dispose() {
    super.dispose();
  }

  Future<void> _loadWalletAddress() async {
    try {
      final client = Supabase.instance.client;
      final userId = client.auth.currentUser?.id;
      if (userId != null) {
        final data = await client
            .from('profiles')
            .select('polygon_wallet_address')
            .eq('id', userId)
            .maybeSingle();
        if (data != null && mounted) {
          setState(() {
            _walletAddress = data['polygon_wallet_address']?.toString() ?? '';
          });
        }
      }
    } catch (e) {
      debugPrint('Failed to load wallet address: $e');
    }
  }

  Future<void> _fetchReputation() async {
    if (!mounted) return;
    setState(() {
      _isLoadingReputation = true;
      _reputationUnavailable = false;
    });

    try {
      final client = Supabase.instance.client;
      final driverId = client.auth.currentUser?.id;
      if (driverId == null) {
        if (mounted) {
          setState(() {
            _isLoadingReputation = false;
          });
        }
        return;
      }

      final apiClient = ApiClient(timeout: AppConfig.profileUpdateTimeout);
      try {
        final data = await apiClient.get('/api/driver/$driverId/reputation');

        if (!mounted) return;

        if (data is Map<String, dynamic>) {
          setState(() {
            _platformRating = data['supabaseRating'] != null
                ? (data['supabaseRating'] as num).toDouble()
                : null;
            _onChainScore = data['onChainScore'] != null
                ? (data['onChainScore'] as num).toInt()
                : null;
            _walletAddress = data['walletAddress']?.toString() ?? '';
            _isLoadingReputation = false;
          });
        } else {
          setState(() {
            _reputationUnavailable = true;
            _isLoadingReputation = false;
          });
        }
      } finally {
        apiClient.dispose();
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _reputationUnavailable = true;
          _isLoadingReputation = false;
        });
      }
    }
  }


  Color _borderColor(BuildContext context) {


    return Theme.of(context).brightness == Brightness.dark
        ? TruxifyColors.darkBorder
        : TruxifyColors.border;
  }

  Future<void> _showEditProfileSheet(BuildContext context) async {
    final formKey = GlobalKey<FormState>();
    final nameController = TextEditingController(text: _driverName);
    final phoneController = TextEditingController(text: _driverPhone);
    final emailController = TextEditingController(text: _driverEmail);
    final truckNumberController = TextEditingController(text: _truckNumber);

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
                AppLocalizations.of(context)!.editProfile,
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              Form(
                key: formKey,
                child: Column(
                  children: [
                    TextFormField(
                      controller: nameController,
                      style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: AppLocalizations.of(context)!.fullNames,
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
                    TextFormField(
                      controller: phoneController,
                      style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: AppLocalizations.of(context)!.phoneNumbers,
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
                    TextFormField(
                      controller: emailController,
                      style: GoogleFonts.dmSans(
                    fontSize: 14,
                    color: Theme.of(context).colorScheme.onSurface),
                decoration: InputDecoration(
                  labelText: AppLocalizations.of(context)!.emailAddress,
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
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: truckNumberController,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurface),
                      decoration: InputDecoration(
                        labelText: AppLocalizations.of(context)!.vehicleRegistrationNumber,
                        hintText: 'e.g., DL01AA1234',
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
                      textCapitalization: TextCapitalization.characters,
                      inputFormatters: [
                        UpperCaseTextFormatter(),
                      ],
                      validator: validateRegistrationNumber,
                      autovalidateMode: AutovalidateMode.onUserInteraction,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: AppLocalizations.of(context)!.saveChanges,
                onPressed: () {
                  if (formKey.currentState?.validate() ?? false) {
                    setState(() {
                      _driverName = nameController.text.trim();
                      _driverPhone = phoneController.text.trim();
                      _driverEmail = emailController.text.trim();
                      _truckNumber = truckNumberController.text.trim();
                    });
                    Navigator.of(context).pop();
                    ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(
                      content: Text(AppLocalizations.of(context)!.profileUpdatedSuccessfully),
                      backgroundColor: TruxifyColors.success,
                    ),
                  );
                }
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
                    AppLocalizations.of(context)!.selectLanguage,
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
                    label: AppLocalizations.of(context)!.applyLanguage,
                    onPressed: () {
                      setState(() {
                        _currentLanguage = selectedLang;
                      });
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content:
                              Text(AppLocalizations.of(context)!.languageSwitched),
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
                AppLocalizations.of(context)!.polygonWalletAddress,
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
                label: AppLocalizations.of(context)!.saveWalletAddress,
                onPressed: () async {
                  final address = walletController.text.trim();
                  if (address.isEmpty) return;
                  try {
                    final apiClient = ApiClient();
                    try {
                      await apiClient.put(
                        '/api/profile/wallet',
                        body: <String, String>{
                          'wallet_address': address,
                        },
                      );
                      setState(() {
                        _walletAddress = address;
                      });
                      if (!context.mounted) return;
                      Navigator.of(context).pop();
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content:
                              Text(AppLocalizations.of(context)!.walletAddressUpdated),
                          backgroundColor: TruxifyColors.success,
                        ),
                      );
                    } else {
                      final body = jsonDecode(response.body)
                          as Map<String, dynamic>;
                      if (context.mounted) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          SnackBar(
                            content: Text(body['error']?.toString() ??
                                AppLocalizations.of(context)!.failedToUpdateWallet),
                            backgroundColor: TruxifyColors.errorRed,
                          ),
                        );
                      }
                    } finally {
                      apiClient.dispose();
                    }
                  } on ApiException catch (e) {
                    if (context.mounted) {
                      ScaffoldMessenger.of(context).showSnackBar(
                        SnackBar(
                          content: Text(e.message),
                          backgroundColor: TruxifyColors.errorRed,
                        ),
                      );
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
                AppLocalizations.of(context)!.helpSupport,
                style: GoogleFonts.dmSans(
                  fontSize: 18,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
              const SizedBox(height: 16),
              _buildHelpOption(
                icon: Icons.help_outline_rounded,
                title: AppLocalizations.of(context)!.browseFAQs,
                subtitle: AppLocalizations.of(context)!.instantAnswers,
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
                color: color.withValues(alpha: 0.1),
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
                AppLocalizations.of(context)!.aboutTruxifyDriverApp,
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
                AppLocalizations.of(context)!.truxifyDescription,
                textAlign: TextAlign.center,
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: AppLocalizations.of(context)!.close,
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
                  color: TruxifyColors.accent.withValues(alpha: 0.15),
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
                        color: Colors.white.withValues(alpha: 0.2), width: 3),
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
                        '$driverTruck · $_truckNumber',
                        style: GoogleFonts.dmSans(
                          fontSize: 12,
                          color: Colors.white.withValues(alpha: 0.85),
                        ),
                      ),
                      const SizedBox(height: 8),
                      Container(
                        padding: const EdgeInsets.symmetric(
                            horizontal: 8, vertical: 3),
                        decoration: BoxDecoration(
                          color: Colors.white.withValues(alpha: 0.15),
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
                  tooltip: AppLocalizations.of(context)!.editProfile,
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

          const SizedBox(height: 12),

          // Reputation Card
          AppCard(
            padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
            child: Row(
              children: [
                Expanded(
                  child: Column(
                    children: [
                      const Icon(Icons.star_rounded, color: Colors.amber, size: 24),
                      const SizedBox(height: 8),
                      Text(
                        _isLoadingReputation
                            ? '...'
                            : _platformRating != null
                                ? '${_platformRating!.toStringAsFixed(1)} / 5.0'
                                : '0.0 / 5.0',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          color: Theme.of(context).colorScheme.onSurface,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'Platform Rating',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.dmSans(
                          fontSize: 11,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                    ],
                  ),
                ),
                Container(
                  width: 1,
                  height: 48,
                  color: _borderColor(context),
                ),
                Expanded(
                  child: Column(
                    children: [
                      const Icon(Icons.link_rounded, color: TruxifyColors.accent, size: 24),
                      const SizedBox(height: 8),
                      Text(
                        _isLoadingReputation
                            ? '...'
                            : (_reputationUnavailable || (_walletAddress.isNotEmpty && _onChainScore == null))
                                ? 'Unavailable'
                                : _walletAddress.isEmpty
                                    ? 'Wallet Not Connected'
                                    : '$_onChainScore / 100',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.dmSans(
                          fontSize: (_walletAddress.isEmpty || _reputationUnavailable || (_walletAddress.isNotEmpty && _onChainScore == null)) && !_isLoadingReputation ? 12 : 16,
                          color: Theme.of(context).colorScheme.onSurface,
                          fontWeight: FontWeight.bold,
                        ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        'On-Chain Reputation',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.dmSans(
                          fontSize: 11,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),

          const SizedBox(height: 16),

          AppCard(
            child: Column(
              children: [
                ListTile(
                  contentPadding:
                      const EdgeInsets.symmetric(horizontal: 12, vertical: 2),
                  title: Text(
                    AppLocalizations.of(context)!.documents,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    AppLocalizations.of(context)!.driverLicensePermitPapers,
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
                    AppLocalizations.of(context)!.notifications,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    AppLocalizations.of(context)!.viewTripAlerts,
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
                    AppLocalizations.of(context)!.walletAddress,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    _walletAddress.isNotEmpty
                        ? '${_walletAddress.substring(0, 10)}...${_walletAddress.substring(_walletAddress.length - 6)}'
                        : AppLocalizations.of(context)!.notSet,
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
                    AppLocalizations.of(context)!.languageLabel,
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
                    AppLocalizations.of(context)!.helpAndSupport247,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    AppLocalizations.of(context)!.helpSupport,
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
                    AppLocalizations.of(context)!.aboutTruxifyDriverApp,
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  subtitle: Text(
                    AppLocalizations.of(context)!.versionAndAppInfo,
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

                  final apiClient = ApiClient(timeout: AppConfig.quickActionTimeout);
                  try {
                    await apiClient.post('/api/auth/logout');
                  } catch (e) {
                    debugPrint('Backend logout failed: $e');
                  } finally {
                    apiClient.dispose();
                  }

                  // Unregister and clear FCM token on logout so this device stops
                  // receiving push notifications for the signed-out account.
                  await FcmService.unregisterToken();
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
                    SnackBar(content: Text(AppLocalizations.of(context)!.logoutFailed)),
                  );
                }
              }
            },
            child: Row(
              children: [
                const Icon(Icons.logout_rounded, color: TruxifyColors.error),
                const SizedBox(width: 12),
                Text(
                  AppLocalizations.of(context)!.logout,
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
      title: AppLocalizations.of(context)!.helpSupport,
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
