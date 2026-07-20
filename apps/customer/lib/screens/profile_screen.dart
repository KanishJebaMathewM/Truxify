import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter/material.dart';
import 'package:truxify/widgets/menu_card.dart';
import 'package:truxify/widgets/menu_item.dart';

import '../controllers/app_controller.dart';
import '../core/api_client.dart';
import '../core/offline/cache/cache_manager.dart';
import '../repositories/address_repository.dart';
import '../repositories/payment_repository.dart';
import '../services/auth_service.dart';
import '../services/profile_service.dart';
import '../l10n/app_localizations.dart';
import '../widgets/truxify_button.dart';
import '../services/fcm_service.dart';
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

class ProfileScreen extends StatefulWidget {
  const ProfileScreen({super.key});

  @override
  State<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends State<ProfileScreen> {
  final _profileService = ProfileService();
  final _paymentRepo = PaymentRepository();
  final _addressRepo = AddressRepository();
  final CacheManager _cacheManager = CacheManager();
  bool _isOffline = false;
  String? _lastUpdatedLabel;
  String _displayName = '';
  String _displayCompany = '';
  String _displayPhone = '';
  String? _defaultPaymentLabel;
  String? _defaultAddressLabel;
  int _totalOrders = 0;
  num _totalSaved = 0;
  num _co2ReducedKg = 0;
  String _walletAddress = '';

  @override
  void initState() {
    super.initState();
    _loadProfile();
  }

  Future<void> _loadProfile() async {
    final connectivity = await Connectivity().checkConnectivity();
    final hasNetwork = connectivity.isNotEmpty &&
        !connectivity.contains(ConnectivityResult.none);
    await _cacheManager.open();

    if (hasNetwork) {
      try {
        final profileResponse = await _profileService.fetchProfile();
        final profile = profileResponse['profile'] as Map<String, dynamic>?;
        final extra = profileResponse['extra'] as Map<String, dynamic>?;

        if (profile != null) {
          await _cacheManager.cacheProfile({
            'name': profile['fullName']?.toString() ?? '',
            'company': profile['companyName']?.toString() ?? '',
            'phone': profile['phone']?.toString() ?? '',
            'totalOrders': extra?['totalOrders']?.toString() ?? '0',
            'totalSaved': extra?['totalSaved']?.toString() ?? '0',
            'co2ReducedKg': extra?['co2ReducedKg']?.toString() ?? '0',
            'walletAddress': profile['walletAddress']?.toString() ?? '',
          });
        }

        final methods = await _paymentRepo.fetchAll();
        final addresses = await _addressRepo.fetchAll();

        if (!mounted) return;

        setState(() {
          _isOffline = false;
          _displayName = profile?['fullName']?.toString() ?? '';
          _displayCompany = profile?['companyName']?.toString() ?? '';
          _displayPhone = profile?['phone']?.toString() ?? '';
          _walletAddress = profile?['walletAddress']?.toString() ?? '';

          String? defaultPayment;
          for (final m in methods) {
            if (m.isDefault) {
              defaultPayment = m.displayLabel;
              break;
            }
          }
          _defaultPaymentLabel = defaultPayment;

          String? defaultAddress;
          for (final a in addresses) {
            if (a.isDefault) {
              defaultAddress = a.label;
              break;
            }
          }
          _defaultAddressLabel = defaultAddress;

          final rawOrders = extra?['totalOrders'];
          _totalOrders = rawOrders is int
              ? rawOrders
              : (rawOrders != null ? (int.tryParse(rawOrders.toString()) ?? 0) : 0);

          final rawSaved = extra?['totalSaved'];
          _totalSaved = rawSaved is num
              ? rawSaved
              : (rawSaved != null ? (num.tryParse(rawSaved.toString()) ?? 0) : 0);

          final rawCo2 = extra?['co2ReducedKg'];
          _co2ReducedKg = rawCo2 is num
              ? rawCo2
              : (rawCo2 != null ? (num.tryParse(rawCo2.toString()) ?? 0) : 0);

          _lastUpdatedLabel = DateTime.now().toIso8601String();
        });
        return;
      } catch (e) {
        debugPrint('Failed to load profile from backend: $e');
      }
    }

    final cachedProfile = await _cacheManager.getProfile();
    if (!mounted) return;

    setState(() {
      _isOffline = !hasNetwork;
      _displayName = cachedProfile?['name']?.toString() ?? '';
      _displayCompany = cachedProfile?['company']?.toString() ?? '';
      _displayPhone = cachedProfile?['phone']?.toString() ?? '';
      _totalOrders = int.tryParse(cachedProfile?['totalOrders']?.toString() ?? '0') ?? 0;
      _totalSaved = num.tryParse(cachedProfile?['totalSaved']?.toString() ?? '0') ?? 0;
      _co2ReducedKg = num.tryParse(cachedProfile?['co2ReducedKg']?.toString() ?? '0') ?? 0;
      _walletAddress = cachedProfile?['walletAddress']?.toString() ?? '';
      _lastUpdatedLabel = cachedProfile?['_cached_at']?.toString();
    });
  }

  String _formatLastUpdated(String? updatedAt) {
    if (updatedAt == null || updatedAt.isEmpty) return 'just now';
    final lastUpdated = DateTime.tryParse(updatedAt);
    if (lastUpdated == null) return 'just now';
    final minutes = DateTime.now().difference(lastUpdated).inMinutes;
    if (minutes < 1) return 'just now';
    return minutes == 1 ? '1 min ago' : '$minutes mins ago';
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
              Container(
                width: 40,
                height: 4,
                margin: const EdgeInsets.only(bottom: 16),
                decoration: BoxDecoration(
                  color: TruxifyColors.hintText,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
              Text(
                AppLocalizations.of(context)!.polygonWalletAddress,
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
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
                            style: const TextStyle(
                              fontSize: 12,
                              fontFamily: 'monospace',
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
                style: const TextStyle(
                  fontSize: 13,
                  fontFamily: 'monospace',
                ),
                decoration: InputDecoration(
                  labelText: '0x...',
                  hintText: '0x1234567890abcdef1234567890abcdef12345678',
                  border: OutlineInputBorder(
                    borderRadius: BorderRadius.circular(12),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
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
                            content: Text(AppLocalizations.of(context)!.walletAddressUpdated),
                            backgroundColor: TruxifyColors.success,
                          ),
                        );
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
                            content: Text(AppLocalizations.of(context)!.error(e.toString())),
                            backgroundColor: TruxifyColors.errorRed,
                          ),
                        );
                      }
                    }
                  },
                  style: ElevatedButton.styleFrom(
                    backgroundColor: TruxifyColors.accent,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(AppLocalizations.of(context)!.saveWalletAddress),
                ),
              ),
            ],
          ),
        );
      },
    );
  }

  void _logout(BuildContext context) async {
    try {
      await _profileService.logout();
    } catch (e) {
      debugPrint('Logout error: $e');
    }

    if (!context.mounted) return;

    await _cacheManager.open();
    await _cacheManager.cacheProfile({});
    
    if (!context.mounted) return;
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
                          border: Border.all(
                              color: Colors.white.withValues(alpha: 0.4),
                              width: 3),
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
                        _displayName,
                        style: Theme.of(context).textTheme.titleLarge?.copyWith(
                              color: Colors.white,
                              fontWeight: FontWeight.w500,
                            ),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        _displayCompany,
                        style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                              color: Colors.white.withValues(alpha: 0.75),
                              fontSize: 13,
                            ),
                      ),
                      const SizedBox(height: 2),
                      Text(
                        _displayPhone,
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
                    onPressed: () => Navigator.of(context).push(AppPageRoute(
                        builder: (_) => const EditProfileScreen())),
                    icon: const Icon(Icons.edit_rounded,
                        color: Colors.white, size: 24),
                    padding: EdgeInsets.zero,
                    constraints: const BoxConstraints(),
                    splashRadius: 20,
                  ),
                ),
              ],
            ),
            if (_isOffline)
              Padding(
                padding: const EdgeInsets.fromLTRB(18, 0, 18, 6),
                child: Text(
                  AppLocalizations.of(context)!.offlineModeLabel(_formatLastUpdated(_lastUpdatedLabel)),
                  style: Theme.of(context)
                      .textTheme
                      .bodySmall
                      ?.copyWith(color: TruxifyColors.accentDark),
                ),
              ),
            Transform.translate(
              offset: const Offset(0, -18),
              child: Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16),
                child: _StatsCard(
                  totalOrders: _totalOrders,
                  totalSaved: _totalSaved,
                  co2ReducedKg: _co2ReducedKg,
                ),
              ),
            ),
            const SizedBox(height: 10),
            _SectionLabel(
                text: AppLocalizations.of(context)!.account,
                padding: const EdgeInsets.symmetric(horizontal: 16)),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MenuCard(
                children: [
                  MenuItem(
                    icon: Icons.credit_card_rounded,
                    label: AppLocalizations.of(context)!.paymentMethods,
                    trailing: _defaultPaymentLabel,
                    onTap: () => Navigator.of(context).push(AppPageRoute(
                        builder: (_) => const PaymentMethodsScreen())),
                  ),
                  MenuItem(
                    icon: Icons.description_rounded,
                    label: AppLocalizations.of(context)!.myDocuments,
                    onTap: () => Navigator.of(context).push(AppPageRoute(
                        builder: (_) => const MyDocumentsScreen())),
                  ),
                  MenuItem(
                    icon: Icons.location_on_rounded,
                    label: AppLocalizations.of(context)!.savedAddresses,
                    trailing: _defaultAddressLabel,
                    showDivider: false,
                    onTap: () => Navigator.of(context).push(AppPageRoute(
                        builder: (_) => const SavedAddressesScreen())),
                  ),
                  MenuItem(
                    icon: Icons.account_balance_wallet_rounded,
                    label: AppLocalizations.of(context)!.walletAddressLabel,
                    trailing: _walletAddress.length >= 10
                        ? '${_walletAddress.substring(0, 6)}...${_walletAddress.substring(_walletAddress.length - 4)}'
                        : _walletAddress.isNotEmpty
                            ? _walletAddress
                            : AppLocalizations.of(context)!.notSet,
                    showDivider: false,
                    onTap: () => _showWalletSheet(context),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            _SectionLabel(
                text: AppLocalizations.of(context)!.preferences,
                padding: const EdgeInsets.symmetric(horizontal: 16)),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MenuCard(
                children: [
                  const _ThemeModeTile(),
                  MenuItem(
                    icon: Icons.language_rounded,
                    label: AppLocalizations.of(context)!.language,
                    trailing: 'English',
                    onTap: () => Navigator.of(context).push(
                        AppPageRoute(builder: (_) => const LanguageScreen())),
                  ),
                  MenuItem(
                    icon: Icons.help_outline_rounded,
                    label: AppLocalizations.of(context)!.helpSupport,
                    onTap: () => Navigator.of(context).push(AppPageRoute(
                        builder: (_) => const HelpSupportScreen())),
                  ),
                  MenuItem(
                    icon: Icons.info_outline_rounded,
                    label: AppLocalizations.of(context)!.aboutTruxify,
                    showDivider: false,
                    onTap: () => Navigator.of(context).push(
                        AppPageRoute(builder: (_) => const AboutScreen())),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 12),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: MenuCard(
                children: [
                  MenuItem(
                    icon: Icons.logout_rounded,
                    label: AppLocalizations.of(context)!.logout,
                    iconBackgroundColor:
                        TruxifyColors.error.withValues(alpha: 0.12),
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
  const _StatsCard({
    required this.totalOrders,
    required this.totalSaved,
    required this.co2ReducedKg,
  });

  final int totalOrders;
  final num totalSaved;
  final num co2ReducedKg;

  @override
  Widget build(BuildContext context) {
    final surface = Theme.of(context).colorScheme.surface;
    final dividerColor = (Theme.of(context).brightness == Brightness.dark
        ? TruxifyColors.darkBorder
        : TruxifyColors.border);
    return Container(
      decoration: BoxDecoration(
        color: surface,
        borderRadius: BorderRadius.circular(16),
        boxShadow: const [
          BoxShadow(
              color: Color(0x14000000), blurRadius: 8, offset: Offset(0, 2)),
        ],
      ),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
      child: Row(
        children: [
          Expanded(
            child: _StatColumn(
              value: '$totalOrders',
              label: AppLocalizations.of(context)!.ordersLabel,
              valueSize: 20,
              addRightDivider: true,
              dividerColor: dividerColor,
            ),
          ),
          Expanded(
            child: _StatColumn(
              value:
                  '₹${(totalSaved / 100).toStringAsFixed(totalSaved % 100 == 0 ? 0 : 2)}',
              label: AppLocalizations.of(context)!.savedLabel,
              valueSize: 16,
              addRightDivider: true,
              dividerColor: dividerColor,
            ),
          ),
          Expanded(
            child: _StatColumn(
              value: '$co2ReducedKg',
              label: AppLocalizations.of(context)!.co2Label,
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
        border: addRightDivider
            ? Border(right: BorderSide(color: dividerColor))
            : null,
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

class _ThemeModeTile extends StatelessWidget {
  const _ThemeModeTile();

  @override
  Widget build(BuildContext context) {
    final controller = TruxifyScope.of(context);
    final currentTheme = controller.themeMode;
    final isDark = Theme.of(context).brightness == Brightness.dark;

    final selectedTheme = currentTheme == ThemeMode.system
        ? (isDark ? ThemeMode.dark : ThemeMode.light)
        : currentTheme;

    final iconBg =
        isDark ? TruxifyColors.darkAccentLight : TruxifyColors.accentLight;

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
                child: const Icon(
                  Icons.dark_mode_rounded,
                  size: 17,
                  color: TruxifyColors.accent,
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: Text(
                  'Theme',
                  style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                        fontWeight: FontWeight.w500,
                        fontSize: 14,
                      ),
                ),
              ),
              SegmentedButton<ThemeMode>(
                showSelectedIcon: false,
                style: ButtonStyle(
                  visualDensity: VisualDensity.compact,
                  padding: WidgetStateProperty.all(
                    const EdgeInsets.symmetric(
                      horizontal: 12,
                      vertical: 8,
                    ),
                  ),
                ),
                segments: const [
                  ButtonSegment<ThemeMode>(
                    value: ThemeMode.light,
                    label: Text(AppLocalizations.of(context)!.lightTheme),
                  ),
                  ButtonSegment<ThemeMode>(
                    value: ThemeMode.dark,
                    label: Text(AppLocalizations.of(context)!.darkTheme),
                  ),
                ],
                selected: {selectedTheme},
                onSelectionChanged: (selection) {
                  controller.setThemeMode(selection.first);
                },
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
