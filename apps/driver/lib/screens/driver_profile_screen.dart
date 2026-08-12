import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:truxify_shared/truxify_shared.dart';
import 'package:flutter/services.dart';

import '../core/app_routes.dart';
import '../core/config.dart';
import '../l10n/app_localizations.dart';
import '../providers/text_scale_provider.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class DriverProfileScreen extends StatefulWidget {
  const DriverProfileScreen({
    super.key,
    this.onOpenDocuments,
    this.onSelectTab,
  });

  final VoidCallback? onOpenDocuments;
  final ValueChanged<int>? onSelectTab;

  @override
  State<DriverProfileScreen> createState() => _DriverProfileScreenState();
}

class _DriverProfileScreenState extends State<DriverProfileScreen> {
  bool _isLoading = true;
  String _driverName = '';
  String _driverPhone = '';
  String _driverEmail = '';
  
  // Driver Details
  double _rating = 0.0;
  int _totalTrips = 0;
  bool _isOnline = false;
  String _kycStatus = 'Unverified';

  // Truck Details
  String? _truckType;
  double _capacityWeight = 0.0;
  double _capacityVolume = 0.0;
  String? _registrationNumber;

  // Badges
  List<Map<String, dynamic>> _badges = [];

  // Documents
  Map<String, String> _documents = {
    'rc_book': 'Missing',
    'driving_licence': 'Missing',
    'insurance': 'Missing',
  };

  @override
  void initState() {
    super.initState();
    _fetchProfileData();
  }

  Future<void> _fetchProfileData() async {
    if (!mounted) return;
    setState(() {
      _isLoading = true;
    });

    final apiClient = ApiClient();
    try {
      final data = await apiClient.get('/api/driver/profile');
      if (!mounted) return;

      if (data != null && data is Map<String, dynamic>) {
        final profile = data['profile'] as Map<String, dynamic>? ?? {};
        final details = data['driverDetails'] as Map<String, dynamic>? ?? {};
        final truck = data['truck'] as Map<String, dynamic>? ?? {};
        final docs = data['documents'] as Map<String, dynamic>? ?? {};

        setState(() {
          _driverName = profile['full_name']?.toString() ?? profile['fullName']?.toString() ?? '';
          _driverPhone = profile['phone']?.toString() ?? '';
          _driverEmail = profile['email']?.toString() ?? '';

          _rating = (details['rating'] as num?)?.toDouble() ?? 0.0;
          _totalTrips = (details['total_trips'] as num?)?.toInt() ?? (details['totalTrips'] as num?)?.toInt() ?? 0;
          _isOnline = details['is_online'] as bool? ?? details['isOnline'] as bool? ?? false;
          _kycStatus = details['kyc_status']?.toString() ?? details['kycStatus']?.toString() ?? 'Unverified';

          _truckType = truck['truck_type']?.toString() ?? truck['type']?.toString();
          _capacityWeight = (truck['capacity_weight_tonnes'] as num?)?.toDouble() ?? (truck['capacityWeight'] as num?)?.toDouble() ?? 0.0;
          _capacityVolume = (truck['capacity_volume_m3'] as num?)?.toDouble() ?? (truck['capacityVolume'] as num?)?.toDouble() ?? 0.0;
          _registrationNumber = truck['registration_number']?.toString() ?? truck['registrationNumber']?.toString();

          final parsedBadges = details['badges'] as List<dynamic>? ?? [];
          _badges = parsedBadges.map((e) => Map<String, dynamic>.from(e as Map)).toList();

          _documents = {
            'rc_book': docs['rc_book']?.toString() ?? 'Missing',
            'driving_licence': docs['driving_licence']?.toString() ?? 'Missing',
            'insurance': docs['insurance']?.toString() ?? 'Missing',
          };
          _isLoading = false;
        });
      }
    } catch (e) {
      debugPrint('Failed to load driver profile: $e');
      if (mounted) {
        setState(() {
          _isLoading = false;
        });
      }
    } finally {
      apiClient.close();
    }
  }

  Future<void> _toggleOnlineStatus(bool value) async {
    final apiClient = ApiClient();
    try {
      setState(() {
        _isOnline = value;
      });
      await apiClient.patch('/api/driver/availability', body: {
        'available': value,
      });
    } catch (e) {
      debugPrint('Failed to toggle availability: $e');
      if (mounted) {
        setState(() {
          _isOnline = !value; // revert
        });
      }
    } finally {
      apiClient.close();
    }
  }

  Future<void> _shareReputationLink() async {
    final client = Supabase.instance.client;
    final driverId = client.auth.currentUser?.id ?? 'driver-id';
    final shareUrl = 'https://truxify.io/reputation/$driverId';

    await Clipboard.setData(ClipboardData(text: shareUrl));
    if (!mounted) return;

    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('On-chain reputation link copied to clipboard!'),
        backgroundColor: TruxifyColors.success,
      ),
    );
  }

  Future<void> _showEditTruckSheet() async {
    final formKey = GlobalKey<FormState>();
    final typeController = TextEditingController(text: _truckType);
    final weightController = TextEditingController(text: _capacityWeight > 0 ? _capacityWeight.toString() : '');
    final volumeController = TextEditingController(text: _capacityVolume > 0 ? _capacityVolume.toString() : '');
    final regController = TextEditingController(text: _registrationNumber);

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
                'Edit Truck Details',
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
                      controller: typeController,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurface),
                      decoration: InputDecoration(
                        labelText: 'Truck Type',
                        hintText: 'e.g., Tata LPT 1613',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      validator: (v) => v == null || v.trim().isEmpty ? 'Truck type is required' : null,
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: weightController,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurface),
                      decoration: InputDecoration(
                        labelText: 'Capacity (Tonnes)',
                        hintText: 'e.g., 15.0',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Capacity is required';
                        if (double.tryParse(v) == null) return 'Must be a valid number';
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: volumeController,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurface),
                      decoration: InputDecoration(
                        labelText: 'Volume (m³)',
                        hintText: 'e.g., 45.0',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Volume is required';
                        if (double.tryParse(v) == null) return 'Must be a valid number';
                        return null;
                      },
                    ),
                    const SizedBox(height: 12),
                    TextFormField(
                      controller: regController,
                      style: GoogleFonts.dmSans(
                          fontSize: 14,
                          color: Theme.of(context).colorScheme.onSurface),
                      decoration: InputDecoration(
                        labelText: 'Registration Number',
                        hintText: 'e.g., MH12PQ9999',
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                        ),
                      ),
                      textCapitalization: TextCapitalization.characters,
                      validator: (v) {
                        if (v == null || v.trim().isEmpty) return 'Registration number is required';
                        return null;
                      },
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Save Truck Details',
                onPressed: () async {
                  if (formKey.currentState?.validate() ?? false) {
                    final apiClient = ApiClient();
                    try {
                      await apiClient.put('/api/driver/truck', body: {
                        'type': typeController.text.trim(),
                        'capacityWeight': double.parse(weightController.text),
                        'capacityVolume': double.parse(volumeController.text),
                        'registrationNumber': regController.text.trim().toUpperCase(),
                      });
                      Navigator.of(context).pop();
                      _fetchProfileData();
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Truck details updated successfully!'),
                          backgroundColor: TruxifyColors.success,
                        ),
                      );
                    } catch (e) {
                      debugPrint('Failed to update truck: $e');
                    } finally {
                      apiClient.close();
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

  Widget _buildDocRow(String title, String status) {
    Color badgeColor = Colors.orange;
    Color textColor = Colors.white;

    if (status.contains('Verified')) {
      badgeColor = TruxifyColors.success;
    } else if (status.contains('Uploaded')) {
      badgeColor = TruxifyColors.accent;
    } else {
      badgeColor = Colors.red.shade600;
    }

    return Container(
      margin: const EdgeInsets.symmetric(vertical: 6),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Theme.of(context).brightness == Brightness.dark
            ? Colors.grey.shade900
            : Colors.grey.shade50,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? Colors.grey.shade800
              : Colors.grey.shade200,
        ),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: GoogleFonts.dmSans(
              fontSize: 14,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
            decoration: BoxDecoration(
              color: badgeColor,
              borderRadius: BorderRadius.circular(20),
            ),
            child: Text(
              status,
              style: GoogleFonts.dmSans(
                fontSize: 11,
                fontWeight: FontWeight.bold,
                color: textColor,
              ),
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Scaffold(
        body: Center(
          child: CircularProgressIndicator(),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(
        title: Text(
          'Driver Profile',
          style: GoogleFonts.dmSans(
            fontWeight: FontWeight.bold,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
        elevation: 0,
        backgroundColor: Colors.transparent,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Driver Card
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  children: [
                    CircleAvatar(
                      radius: 36,
                      backgroundColor: TruxifyColors.accent.withOpacity(0.1),
                      child: const Icon(
                        Icons.person,
                        size: 36,
                        color: TruxifyColors.accent,
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
                              color: Theme.of(context).colorScheme.onSurface,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            _driverPhone,
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              color: Colors.grey.shade600,
                            ),
                          ),
                          const SizedBox(height: 2),
                          Text(
                            _driverEmail,
                            style: GoogleFonts.dmSans(
                              fontSize: 12,
                              color: Colors.grey.shade500,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Availability Card
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Duty Status',
                          style: GoogleFonts.dmSans(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                        ),
                        const SizedBox(height: 2),
                        Text(
                          _isOnline ? 'Online (Ready for Jobs)' : 'Offline (Unavailable)',
                          style: GoogleFonts.dmSans(
                            fontSize: 13,
                            color: _isOnline ? TruxifyColors.success : Colors.grey,
                          ),
                        ),
                      ],
                    ),
                    Switch.adaptive(
                      value: _isOnline,
                      onChanged: _toggleOnlineStatus,
                      activeColor: TruxifyColors.success,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Reputation Section
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'On-Chain Reputation',
                          style: GoogleFonts.dmSans(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                        ),
                        GestureDetector(
                          onTap: _shareReputationLink,
                          child: Row(
                            children: [
                              const Icon(Icons.share, size: 16, color: TruxifyColors.accent),
                              const SizedBox(width: 4),
                              Text(
                                'Share',
                                style: GoogleFonts.dmSans(
                                  fontSize: 13,
                                  color: TruxifyColors.accent,
                                  fontWeight: FontWeight.bold,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: 24),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        Column(
                          children: [
                            Row(
                              children: [
                                const Icon(Icons.star, color: Colors.amber, size: 24),
                                const SizedBox(width: 4),
                                Text(
                                  _rating.toStringAsFixed(1),
                                  style: GoogleFonts.dmSans(
                                    fontSize: 18,
                                    fontWeight: FontWeight.bold,
                                    color: Theme.of(context).colorScheme.onSurface,
                                  ),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Rating',
                              style: GoogleFonts.dmSans(fontSize: 12, color: Colors.grey),
                            ),
                          ],
                        ),
                        Column(
                          children: [
                            Text(
                              _totalTrips.toString(),
                              style: GoogleFonts.dmSans(
                                fontSize: 18,
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context).colorScheme.onSurface,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Total Trips',
                              style: GoogleFonts.dmSans(fontSize: 12, color: Colors.grey),
                            ),
                          ],
                        ),
                        Column(
                          children: [
                            Text(
                              _kycStatus,
                              style: GoogleFonts.dmSans(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: _kycStatus == 'Verified' ? TruxifyColors.success : Colors.grey,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'KYC Status',
                              style: GoogleFonts.dmSans(fontSize: 12, color: Colors.grey),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Badges Card
            _buildBadgesCard(),

            // Truck Details Card
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text(
                          'Truck Details',
                          style: GoogleFonts.dmSans(
                            fontSize: 15,
                            fontWeight: FontWeight.bold,
                            color: Theme.of(context).colorScheme.onSurface,
                          ),
                        ),
                        IconButton(
                          icon: const Icon(Icons.edit, color: TruxifyColors.accent, size: 20),
                          onPressed: _showEditTruckSheet,
                        ),
                      ],
                    ),
                    const Divider(height: 16),
                    _buildTruckRow('Type', _truckType ?? 'Not Assigned'),
                    _buildTruckRow('Capacity (Weight)', '${_capacityWeight.toStringAsFixed(1)} Tonnes'),
                    _buildTruckRow('Capacity (Volume)', '${_capacityVolume.toStringAsFixed(1)} m³'),
                    _buildTruckRow('Registration Number', _registrationNumber ?? 'N/A'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Documents Card
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(16.0),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Verification Documents',
                      style: GoogleFonts.dmSans(
                        fontSize: 15,
                        fontWeight: FontWeight.bold,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                    const Divider(height: 16),
                    _buildDocRow('Registration Certificate (RC)', _documents['rc_book'] ?? 'Missing'),
                    _buildDocRow('Driving Licence (DL)', _documents['driving_licence'] ?? 'Missing'),
                    _buildDocRow('Insurance Policy', _documents['insurance'] ?? 'Missing'),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),

            // Display / UI Scaling Card
            Card(
              elevation: 4,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(16),
              ),
              child: Padding(
                padding: const EdgeInsets.all(8.0),
                child: Consumer<TextScaleProvider>(
                  builder: (context, scaleProvider, child) {
                    return SwitchListTile.adaptive(
                      title: Text(
                        'Enable Large Text',
                        style: GoogleFonts.dmSans(
                          fontSize: 15,
                          fontWeight: FontWeight.bold,
                          color: Theme.of(context).colorScheme.onSurface,
                        ),
                      ),
                      subtitle: Text(
                        'Optimized for dashboard mounting',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: Colors.grey.shade600,
                        ),
                      ),
                      value: scaleProvider.isLargeText,
                      onChanged: (val) => scaleProvider.toggleScale(val),
                      activeColor: TruxifyColors.accent,
                    );
                  },
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildBadgesCard() {
    if (_badges.isEmpty) return const SizedBox.shrink();

    return Column(
      children: [
        Card(
          elevation: 4,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          child: Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'Achievements',
                  style: GoogleFonts.dmSans(
                    fontSize: 15,
                    fontWeight: FontWeight.bold,
                    color: Theme.of(context).colorScheme.onSurface,
                  ),
                ),
                const Divider(height: 16),
                Wrap(
                  spacing: 8,
                  runSpacing: 8,
                  children: _badges.map((badge) {
                    return Chip(
                      avatar: Text(badge['icon']?.toString() ?? '🏆', style: const TextStyle(fontSize: 16)),
                      label: Text(
                        badge['label']?.toString() ?? 'Badge',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                      backgroundColor: Theme.of(context).brightness == Brightness.dark
                          ? Colors.grey.shade900
                          : Colors.amber.shade50,
                      side: BorderSide(
                        color: Colors.amber.shade200,
                      ),
                    );
                  }).toList(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: 16),
      ],
    );
  }

  Widget _buildTruckRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              color: Colors.grey.shade600,
            ),
          ),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              fontWeight: FontWeight.w600,
              color: Theme.of(context).colorScheme.onSurface,
            ),
          ),
        ],
      ),
    );
  }
}
