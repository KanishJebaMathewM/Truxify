import 'dart:io';

import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:image_picker/image_picker.dart';
import 'package:intl/intl.dart';
import '../models/truck_models.dart';
import '../services/api_client.dart';
import '../services/truck_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../core/driver_session.dart';
import '../widgets/maintenance_photo_picker.dart';
import '../widgets/maintenance_photo_gallery.dart';

class MyTruckScreen extends StatefulWidget {
  const MyTruckScreen({super.key});

  @override
  State<MyTruckScreen> createState() => _MyTruckScreenState();
}

class _MyTruckScreenState extends State<MyTruckScreen> {
  final TruckRepository _truckRepository = TruckRepository();

  bool _isLoading = true;
  String? _errorMessage;
  Truck? _truck;
  List<TruckMaintenanceTicket> _reportedIssues = [];

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  Future<void> _loadData() async {
    setState(() {
      _isLoading = true;
      _errorMessage = null;
    });

    try {
      final driverId = DriverSession.driverId;

      final truck = await _truckRepository.fetchTruckForDriver(driverId);
      if (truck == null) {
        setState(() {
          _errorMessage = 'No truck assigned to this driver';
          _isLoading = false;
        });
        return;
      }
      final tickets = await _truckRepository.fetchMaintenanceTickets(truck.id);

      if (mounted) {
        setState(() {
          _truck = truck;
          _reportedIssues = tickets;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _errorMessage = 'Failed to load truck data: $e';
          _isLoading = false;
        });
      }
    }
  }

  Future<void> _showReportIssueSheet(BuildContext context) async {
    String selectedCategory = 'Engine';
    final descController = TextEditingController();
    bool isSubmitting = false;
    List<XFile> selectedPhotos = [];

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
              padding: EdgeInsets.fromLTRB(
                  20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const BottomSheetHandle(),
                    const SizedBox(height: 16),
                    Text(
                      'Report Maintenance Issue',
                      style: GoogleFonts.dmSans(
                        fontSize: 18,
                        fontWeight: FontWeight.bold,
                        color: Theme.of(context).colorScheme.onSurface,
                      ),
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Select Issue Category',
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                    ),
                    const SizedBox(height: 8),
                    DropdownButtonFormField<String>(
                      value: selectedCategory,
                      decoration: InputDecoration(
                        contentPadding: const EdgeInsets.symmetric(
                            horizontal: 14, vertical: 12),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide:
                              const BorderSide(color: TruxifyColors.border),
                        ),
                      ),
                      items: [
                        'Engine',
                        'Tyres',
                        'Brakes',
                        'Electricals',
                        'Documents',
                        'Other'
                      ]
                          .map((cat) => DropdownMenuItem(
                              value: cat,
                              child: Text(cat, style: GoogleFonts.dmSans())))
                          .toList(),
                      onChanged: (val) {
                        if (val != null) {
                          setSheetState(() => selectedCategory = val);
                        }
                      },
                    ),
                    const SizedBox(height: 16),
                    Text(
                      'Describe the problem in detail',
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.adaptiveSecondaryText(context),
                      ),
                    ),
                    const SizedBox(height: 8),
                    TextField(
                      controller: descController,
                      maxLines: 3,
                      style: GoogleFonts.dmSans(fontSize: 14),
                      decoration: InputDecoration(
                        hintText:
                            'e.g. Squeaking sound from front brakes when slowing down...',
                        hintStyle: GoogleFonts.dmSans(
                            color: TruxifyColors.hintText, fontSize: 13),
                        border: OutlineInputBorder(
                          borderRadius: BorderRadius.circular(12),
                          borderSide: BorderSide(
                            color: Theme.of(context).brightness == Brightness.dark
                                ? TruxifyColors.darkBorder
                                : TruxifyColors.border,
                          ),
                        ),
                      ),
                    ),
                    const SizedBox(height: 16),
                    MaintenancePhotoPicker(
                      selectedPhotos: selectedPhotos,
                      onPhotosChanged: (photos) {
                        setSheetState(() => selectedPhotos = photos);
                      },
                    ),
                    const SizedBox(height: 20),
                    isSubmitting
                        ? const Center(
                            child: Padding(
                              padding: EdgeInsets.all(12.0),
                              child: CircularProgressIndicator(
                                  color: TruxifyColors.accent),
                            ),
                          )
                        : PrimaryButton(
                            label: selectedPhotos.isNotEmpty
                                ? 'Submit Ticket (${selectedPhotos.length} photo${selectedPhotos.length > 1 ? 's' : ''})'
                                : 'Submit Ticket',
                            onPressed: () async {
                              if (descController.text.trim().isEmpty) {
                                ScaffoldMessenger.of(context).showSnackBar(
                                  const SnackBar(
                                    content:
                                        Text('Please enter an issue description'),
                                    backgroundColor: TruxifyColors.error,
                                  ),
                                );
                                return;
                              }
                              final navigator = Navigator.of(context);
                              final messenger = ScaffoldMessenger.of(context);
                              setSheetState(() => isSubmitting = true);

                              try {
                                final newTicket = await _truckRepository
                                    .createMaintenanceTicket(
                                  truckId: _truck!.id,
                                  driverId: _truck!.driverId,
                                  category: selectedCategory,
                                  description: descController.text.trim(),
                                );

                                // Upload photos if any were selected
                                if (selectedPhotos.isNotEmpty) {
                                  final files = <MultipartFileInfo>[];
                                  for (final photo in selectedPhotos) {
                                    final file = File(photo.path);
                                    final bytes = await file.readAsBytes();
                                    files.add(MultipartFileInfo(
                                      fieldName: 'photos',
                                      bytes: bytes,
                                      fileName: photo.name,
                                    ));
                                  }

                                  final urls =
                                      await _truckRepository.uploadMaintenancePhotos(
                                    ticketId: newTicket.id,
                                    files: files,
                                  );

                                  // Create updated ticket with photo URLs
                                  final updatedTicket = TruckMaintenanceTicket(
                                    id: newTicket.id,
                                    truckId: newTicket.truckId,
                                    driverId: newTicket.driverId,
                                    category: newTicket.category,
                                    description: newTicket.description,
                                    status: newTicket.status,
                                    createdAt: newTicket.createdAt,
                                    photoUrls: urls,
                                  );

                                  if (!mounted) return;
                                  setState(() {
                                    final idx = _reportedIssues.indexWhere(
                                        (t) => t.id == updatedTicket.id);
                                    if (idx >= 0) {
                                      _reportedIssues[idx] = updatedTicket;
                                    } else {
                                      _reportedIssues.insert(0, updatedTicket);
                                    }
                                  });
                                  navigator.pop();
                                  messenger.showSnackBar(
                                    SnackBar(
                                      content: Text(
                                          'Ticket submitted with ${urls.length} photo${urls.length > 1 ? 's' : ''}'),
                                      backgroundColor: TruxifyColors.success,
                                    ),
                                  );
                                } else {
                                  if (!mounted) return;
                                  setState(() {
                                    _reportedIssues.insert(0, newTicket);
                                  });
                                  navigator.pop();
                                  messenger.showSnackBar(
                                    const SnackBar(
                                      content: Text(
                                          'Maintenance ticket submitted successfully'),
                                      backgroundColor: TruxifyColors.success,
                                    ),
                                  );
                                }
                              } catch (e) {
                                setSheetState(() => isSubmitting = false);
                                messenger.showSnackBar(
                                  SnackBar(
                                    content: Text('Failed to submit ticket: $e'),
                                    backgroundColor: TruxifyColors.error,
                                  ),
                                );
                              }
                            },
                          ),
                  ],
                ),
              ),
            );
          },
        );
      },
    );
  }

  Future<void> _showDocumentPreview(
      BuildContext context, String title, DateTime? expiryDate) async {
    final formattedExpiry = expiryDate != null
        ? DateFormat('MMM yyyy').format(expiryDate)
        : 'Unknown';
    final isCompliant =
        expiryDate != null && expiryDate.isAfter(DateTime.now());

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Theme.of(context).colorScheme.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    title,
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.onSurface,
                    ),
                  ),
                  Container(
                    padding:
                        const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: isCompliant
                          ? TruxifyColors.success.withValues(alpha: 0.1)
                          : TruxifyColors.error.withValues(alpha: 0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isCompliant ? 'ACTIVE' : 'EXPIRED',
                      style: GoogleFonts.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: isCompliant
                            ? TruxifyColors.success
                            : TruxifyColors.error,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 20),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(
                    color: Theme.of(context).brightness == Brightness.dark
                        ? TruxifyColors.darkBorder
                        : TruxifyColors.border,
                  ),
                ),
                child: Column(
                  children: [
                    Icon(
                        isCompliant
                            ? Icons.verified_user_rounded
                            : Icons.gpp_bad_rounded,
                        color: isCompliant
                            ? TruxifyColors.success
                            : TruxifyColors.error,
                        size: 48),
                    const SizedBox(height: 12),
                    Text(
                      'Government Document',
                      style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: Theme.of(context).colorScheme.onSurface),
                    ),
                    Text(
                      'Issuer: Ministry of Road Transport & Highways',
                      style: GoogleFonts.dmSans(
                          fontSize: 11,
                          color: TruxifyColors.adaptiveSecondaryText(context)),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Expiry Date:',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: TruxifyColors.hintText)),
                        Text(formattedExpiry,
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: Theme.of(context).colorScheme.onSurface)),
                      ],
                    ),
                    Divider(
                      height: 16,
                      color: Theme.of(context).brightness == Brightness.dark
                          ? TruxifyColors.darkBorder
                          : TruxifyColors.border,
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Status:',
                            style: GoogleFonts.dmSans(
                                fontSize: 12, color: TruxifyColors.hintText)),
                        Text(isCompliant ? 'COMPLIANT' : 'EXPIRED',
                            style: GoogleFonts.dmSans(
                                fontSize: 12,
                                fontWeight: FontWeight.bold,
                                color: isCompliant
                                    ? TruxifyColors.success
                                    : TruxifyColors.error)),
                      ],
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 20),
              PrimaryButton(
                label: 'Close Preview',
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
    if (_isLoading) {
      return Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        body: const Center(
            child: CircularProgressIndicator(color: TruxifyColors.accent)),
      );
    }

    if (_errorMessage != null || _truck == null) {
      return Scaffold(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        appBar: AppBar(
          backgroundColor: Theme.of(context).scaffoldBackgroundColor,
          elevation: 0,
          leading: IconButton(
            icon: Icon(Icons.arrow_back_rounded,
                color: Theme.of(context).colorScheme.onSurface),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.directions_car_rounded,
                    size: 64, color: TruxifyColors.hintText),
                const SizedBox(height: 16),
                Text(
                  _errorMessage ?? 'No truck found',
                  textAlign: TextAlign.center,
                  style: GoogleFonts.dmSans(
                    fontSize: 16,
                    color: TruxifyColors.secondaryText,
                  ),
                ),
                const SizedBox(height: 24),
                PrimaryButton(
                  label: 'Retry',
                  onPressed: _loadData,
                )
              ],
            ),
          ),
        ),
      );
    }

    final truck = _truck!;

    // Fallback formatters for dates
    final insFormat = truck.insuranceExpiry != null
        ? DateFormat('MMM yyyy').format(truck.insuranceExpiry!)
        : 'N/A';
    final pucFormat = truck.pucExpiry != null
        ? DateFormat('MMM yyyy').format(truck.pucExpiry!)
        : 'N/A';
    final permitFormat = truck.permitExpiry != null
        ? DateFormat('MMM yyyy').format(truck.permitExpiry!)
        : 'N/A';

    return DefaultTabController(
      length: 2,
      child: Scaffold(
      backgroundColor: Theme.of(context).scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: Theme.of(context).scaffoldBackgroundColor,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back_rounded,
              color: Theme.of(context).colorScheme.onSurface),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'My Truck Dashboard',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: Theme.of(context).colorScheme.onSurface,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.calculate_outlined, color: TruxifyColors.accent),
            tooltip: 'Weight Calculator',
            onPressed: () => Navigator.pushNamed(context, '/weight-calculator'),
          ),
          IconButton(
            icon: const Icon(Icons.build_rounded, color: TruxifyColors.accent),
            tooltip: 'Report Issue',
            onPressed: () => _showReportIssueSheet(context),
          ),
        ],
        bottom: const TabBar(
          indicatorColor: TruxifyColors.accent,
          labelColor: TruxifyColors.accent,
          unselectedLabelColor: TruxifyColors.hintText,
          tabs: [
            Tab(text: 'Overview'),
            Tab(text: 'Fuel Analytics'),
          ],
        ),
        shape: Border(
          bottom: BorderSide(
            color: Theme.of(context).brightness == Brightness.dark
                ? TruxifyColors.darkBorder
                : TruxifyColors.border,
          ),
        ),
      ),
      body: TabBarView(
        children: [
          SafeArea(
        child: RefreshIndicator(
          onRefresh: _loadData,
          color: TruxifyColors.accent,
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              // 1. Hero Truck Card
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
                      color: TruxifyColors.accent.withValues(alpha: 0.12),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    )
                  ],
                ),
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.center,
                  children: [
                    Text(
                      truck.numberPlate,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.robotoMono(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 10),
                    Text(
                      truck.name,
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Max Capacity: ${truck.maxCapacityTons} Tons',
                      textAlign: TextAlign.center,
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        color: Colors.white.withValues(alpha: 0.7),
                      ),
                    ),
                    const SizedBox(height: 6),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Active maintenance tickets
              if (_reportedIssues.isNotEmpty) ...[
                Text(
                  'MAINTENANCE TICKETS',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    letterSpacing: 0.8,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.adaptiveSecondaryText(context),
                  ),
                ),
                const SizedBox(height: 12),
                ..._reportedIssues.map((ticket) {
                  final hasPhotos = ticket.photoUrls.isNotEmpty;
                  return AppCard(
                    margin: const EdgeInsets.only(bottom: 12),
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: ticket.status.toLowerCase() == 'open'
                                ? TruxifyColors.warning.withValues(alpha: 0.1)
                                : TruxifyColors.success.withValues(alpha: 0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                              ticket.status.toLowerCase() == 'open'
                                  ? Icons.error_outline_rounded
                                  : Icons.check_circle_outline_rounded,
                              color: ticket.status.toLowerCase() == 'open'
                                  ? TruxifyColors.warning
                                  : TruxifyColors.success,
                              size: 18),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment:
                                    MainAxisAlignment.spaceBetween,
                                children: [
                                  Row(
                                    children: [
                                      Text(
                                        ticket.category,
                                        style: GoogleFonts.dmSans(
                                            fontWeight: FontWeight.bold,
                                            fontSize: 13),
                                      ),
                                      if (hasPhotos) ...[
                                        const SizedBox(width: 6),
                                        GestureDetector(
                                          onTap: () =>
                                              MaintenancePhotoGallery.show(
                                            context,
                                            ticket.photoUrls,
                                          ),
                                          child: Container(
                                            padding: const EdgeInsets.symmetric(
                                                horizontal: 6, vertical: 2),
                                            decoration: BoxDecoration(
                                              color: TruxifyColors.accent
                                                  .withValues(alpha: 0.1),
                                              borderRadius:
                                                  BorderRadius.circular(8),
                                            ),
                                            child: Row(
                                              mainAxisSize: MainAxisSize.min,
                                              children: [
                                                const Icon(
                                                  Icons.photo_camera_rounded,
                                                  size: 10,
                                                  color: TruxifyColors.accent,
                                                ),
                                                const SizedBox(width: 3),
                                                Text(
                                                  '${ticket.photoUrls.length}',
                                                  style: GoogleFonts.dmSans(
                                                    fontSize: 9,
                                                    fontWeight: FontWeight.bold,
                                                    color: TruxifyColors.accent,
                                                  ),
                                                ),
                                              ],
                                            ),
                                          ),
                                        ),
                                      ],
                                    ],
                                  ),
                                  Text(
                                    ticket.status,
                                    style: GoogleFonts.robotoMono(
                                        fontSize: 10,
                                        color: ticket.status.toLowerCase() ==
                                                'open'
                                            ? TruxifyColors.warning
                                            : TruxifyColors.success),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                ticket.description,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.adaptiveSecondaryText(context)),
                              ),
                              if (ticket.createdAt != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  DateFormat('dd MMM, yyyy')
                                      .format(ticket.createdAt!),
                                  style: GoogleFonts.dmSans(
                                      fontSize: 9,
                                      color: TruxifyColors.hintText),
                                )
                              ]
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                }),
                const SizedBox(height: 32),
              ],

              if (_reportedIssues.isEmpty) ...[
                AppCard(
                  padding: const EdgeInsets.symmetric(
                    vertical: 28,
                    horizontal: 20,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.center,
                    children: [
                      Icon(
                        Icons.build_circle_outlined,
                        size: 40,
                        color: TruxifyColors.hintText,
                      ),
                      const SizedBox(height: 12),
                      Text(
                        'No maintenance tickets reported',
                        textAlign: TextAlign.center,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: TruxifyColors.adaptiveSecondaryText(context),
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 32),
              ],

              // 3. Official Specs & Certificates
              Text(
                'OFFICIAL SPECS & COMPLIANCE',
                style: GoogleFonts.dmSans(
                  fontSize: 11,
                  letterSpacing: 0.8,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.adaptiveSecondaryText(context),
                ),
              ),
              const SizedBox(height: 12),
              AppCard(
                child: Column(
                  children: [
                    _buildSpecRow(
                      icon: Icons.fitness_center_rounded,
                      label: 'Max Carrying Capacity',
                      value: '${truck.maxCapacityTons} Tons',
                    ),
                    const Divider(height: 1, color: TruxifyColors.border),
                    _buildSpecRow(
                      icon: Icons.verified_user_outlined,
                      label: 'Insurance Cover',
                      value: 'Active (Expires $insFormat)',
                      onTap: () => _showDocumentPreview(
                          context, 'Insurance Cover', truck.insuranceExpiry),
                    ),
                    const Divider(height: 1, color: TruxifyColors.border),
                    _buildSpecRow(
                      icon: Icons.eco_outlined,
                      label: 'Pollution Under Control',
                      value: 'Active (Expires $pucFormat)',
                      onTap: () => _showDocumentPreview(
                          context, 'Pollution Certificate', truck.pucExpiry),
                    ),
                    const Divider(height: 1, color: TruxifyColors.border),
                    _buildSpecRow(
                      icon: Icons.card_membership_rounded,
                      label: 'National Carriage Permit',
                      value: 'Active (Expires $permitFormat)',
                      onTap: () => _showDocumentPreview(context,
                          'National Carriage Permit', truck.permitExpiry),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 24),
            ],
          ),
        ),
      ),
          _FuelAnalyticsTab(averageMpg: truck.averageMpg),
        ],
      ),
    ));
  }

  Widget _buildSpecRow({
    required IconData icon,
    required String label,
    required String value,
    VoidCallback? onTap,
  }) {
    final isDark = Theme.of(context).brightness == Brightness.dark;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        child: Row(
          children: [
            Icon(icon,
                size: 18,
                color: isDark ? TruxifyColors.accent : TruxifyColors.accentDark),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: GoogleFonts.dmSans(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: Theme.of(context).colorScheme.onSurface,
                ),
              ),
            ),
            Text(
              value,
              style: GoogleFonts.dmSans(
                fontSize: 11,
                color: onTap != null
                    ? TruxifyColors.accent
                    : TruxifyColors.adaptiveSecondaryText(context),
                fontWeight: onTap != null ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            if (onTap != null) ...[
              const SizedBox(width: 4),
              const Icon(Icons.arrow_forward_ios_rounded,
                  color: TruxifyColors.accent, size: 10),
            ],
          ],
        ),
      ),
    );
  }
}


class _FuelAnalyticsTab extends StatefulWidget {
  final double averageMpg;
  const _FuelAnalyticsTab({required this.averageMpg});

  @override
  State<_FuelAnalyticsTab> createState() => _FuelAnalyticsTabState();
}

class _FuelAnalyticsTabState extends State<_FuelAnalyticsTab> {
  final FuelAnalyticsService _service = FuelAnalyticsService();
  bool _isLoading = true;
  String? _error;
  Map<String, dynamic>? _data;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final data = await _service.calculateAnalytics(widget.averageMpg);
      if (mounted) {
        setState(() {
          _data = data;
          _isLoading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = e.toString();
          _isLoading = false;
        });
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator(color: TruxifyColors.accent));
    }
    if (_error != null) {
      return Center(child: Text(_error!, style: const TextStyle(color: TruxifyColors.error)));
    }

    final totalPayout = _data!['totalPayout'] as double;
    final estFuel = _data!['estimatedFuelCost'] as double;
    final margin = _data!['profitMargin'] as double;
    final chartPoints = _data!['chartPoints'] as List<Map<String, dynamic>>;

    return RefreshIndicator(
      onRefresh: _load,
      color: TruxifyColors.accent,
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          // Summary Cards
          Row(
            children: [
              Expanded(child: _StatCard(title: 'Total Payout', value: '\$${totalPayout.toStringAsFixed(2)}')),
              const SizedBox(width: 12),
              Expanded(child: _StatCard(title: 'Est. Fuel', value: '\$${estFuel.toStringAsFixed(2)}')),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(child: _StatCard(title: 'Profit Margin', value: '${margin.toStringAsFixed(1)}%')),
              const SizedBox(width: 12),
              Expanded(child: _StatCard(title: 'Avg MPG', value: widget.averageMpg.toStringAsFixed(1))),
            ],
          ),
          const SizedBox(height: 24),
          Text(
            'RECENT TRIPS (PAYOUT VS FUEL)',
            style: GoogleFonts.dmSans(
              fontSize: 11,
              letterSpacing: 0.8,
              fontWeight: FontWeight.bold,
              color: TruxifyColors.adaptiveSecondaryText(context),
            ),
          ),
          const SizedBox(height: 12),
          if (chartPoints.isEmpty)
            const Center(child: Padding(
              padding: EdgeInsets.all(24.0),
              child: Text('No recent trips to display'),
            ))
          else
            ...chartPoints.map((p) => _buildChartBar(context, p['label'], p['payout'], p['fuelCost'])),
        ],
      ),
    );
  }

  Widget _buildChartBar(BuildContext context, String label, double payout, double fuel) {
    final maxVal = payout > fuel ? payout : fuel;
    final payoutFlex = maxVal > 0 ? (payout / maxVal * 100).toInt() : 0;
    final fuelFlex = maxVal > 0 ? (fuel / maxVal * 100).toInt() : 0;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold)),
          const SizedBox(height: 6),
          Row(
            children: [
              SizedBox(
                width: 70,
                child: Text('Payout', style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.success)),
              ),
              Expanded(
                child: Row(
                  children: [
                    if (payoutFlex > 0)
                      Expanded(flex: payoutFlex, child: Container(height: 12, color: TruxifyColors.success)),
                    if (100 - payoutFlex > 0)
                      Expanded(flex: 100 - payoutFlex, child: const SizedBox()),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text('\$${payout.toStringAsFixed(0)}', style: GoogleFonts.dmSans(fontSize: 11)),
            ],
          ),
          const SizedBox(height: 4),
          Row(
            children: [
              SizedBox(
                width: 70,
                child: Text('Fuel', style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.warning)),
              ),
              Expanded(
                child: Row(
                  children: [
                    if (fuelFlex > 0)
                      Expanded(flex: fuelFlex, child: Container(height: 12, color: TruxifyColors.warning)),
                    if (100 - fuelFlex > 0)
                      Expanded(flex: 100 - fuelFlex, child: const SizedBox()),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              Text('\$${fuel.toStringAsFixed(0)}', style: GoogleFonts.dmSans(fontSize: 11)),
            ],
          ),
        ],
      ),
    );
  }
}

class _StatCard extends StatelessWidget {
  final String title;
  final String value;
  const _StatCard({required this.title, required this.value});

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(
          color: Theme.of(context).brightness == Brightness.dark
              ? TruxifyColors.darkBorder
              : TruxifyColors.border,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(title, style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.adaptiveSecondaryText(context))),
          const SizedBox(height: 4),
          Text(value, style: GoogleFonts.dmSans(fontSize: 18, fontWeight: FontWeight.bold, color: Theme.of(context).colorScheme.onSurface)),
        ],
      ),
    );
  }
}
