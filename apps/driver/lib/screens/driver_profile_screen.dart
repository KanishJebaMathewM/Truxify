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
          _capacityWeight = (truck['max_capacity_tons'] as num?)?.toDouble()
              ?? (truck['capacity_weight_tonnes'] as num?)?.toDouble()
              ?? (truck['capacityWeight'] as num?)?.toDouble()
              ?? 0.0;
          _capacityVolume = (truck['capacity_volume_m3'] as num?)?.toDouble() ?? (truck['capacityVolume'] as num?)?.toDouble() ?? 0.0;
          _registrationNumber = truck['number_plate']?.toString()
              ?? truck['registration_number']?.toString()
              ?? truck['registrationNumber']?.toString();

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
                    const SizedBox(height
