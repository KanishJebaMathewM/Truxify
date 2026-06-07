import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import 'package:intl/intl.dart';
import '../models/truck_models.dart';
import '../services/truck_repository.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../core/driver_session.dart';

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
  List<TyreDiagnostic> _tyreDiagnostics = [];
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

      final diagnostics = await _truckRepository.fetchTyreDiagnostics(truck.id);
      final tickets = await _truckRepository.fetchMaintenanceTickets(truck.id);

      if (mounted) {
        setState(() {
          _truck = truck;
          _tyreDiagnostics = diagnostics;
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

  Future<void> _showTyreDiagnostics(BuildContext context) async {
    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        final allOptimal = _tyreDiagnostics.every((t) => t.status == 'Optimal' || t.status == 'Good');

        return Padding(
          padding: const EdgeInsets.fromLTRB(20, 10, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const BottomSheetHandle(),
              const SizedBox(height: 16),
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'Tyre Pressure & Wear Logs',
                    style: GoogleFonts.dmSans(
                      fontSize: 18,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: allOptimal 
                          ? TruxifyColors.success.withOpacity(0.1)
                          : TruxifyColors.warning.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      allOptimal ? 'All Optimal' : 'Needs Attention',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: allOptimal ? TruxifyColors.success : TruxifyColors.warning,
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),
              Text(
                'Regular tire inspections ensure safety and optimize fuel efficiency. Below are current telemetry readings from internal TPMS sensors.',
                style: GoogleFonts.dmSans(
                  fontSize: 13,
                  color: TruxifyColors.secondaryText,
                  height: 1.4,
                ),
              ),
              const SizedBox(height: 16),
              Table(
                border: TableBorder.all(color: TruxifyColors.border, width: 1, borderRadius: BorderRadius.circular(8)),
                columnWidths: const {
                  0: FlexColumnWidth(2),
                  1: FlexColumnWidth(1),
                  2: FlexColumnWidth(1.2),
                },
                children: [
                  TableRow(
                    decoration: const BoxDecoration(color: TruxifyColors.secondaryBackground),
                    children: [
                      Padding(
                        padding: const EdgeInsets.all(12.0),
                        child: Text('Position', style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 13)),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(12.0),
                        child: Text('PSI', style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 13)),
                      ),
                      Padding(
                        padding: const EdgeInsets.all(12.0),
                        child: Text('Status', style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 13)),
                      ),
                    ],
                  ),
                  ..._tyreDiagnostics.map((diagnostic) {
                    final isGood = diagnostic.status == 'Optimal' || diagnostic.status == 'Good';
                    final isCritical = diagnostic.status == 'Critical';
                    Color statusColor = isGood ? TruxifyColors.success : (isCritical ? TruxifyColors.error : TruxifyColors.warning);

                    return TableRow(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(diagnostic.position, style: GoogleFonts.dmSans(fontSize: 13)),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(diagnostic.pressurePsi.toStringAsFixed(0), style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold)),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(
                            diagnostic.status,
                            style: GoogleFonts.dmSans(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: statusColor,
                            ),
                          ),
                        ),
                      ],
                    );
                  }),
                ],
              ),
              const SizedBox(height: 20),
              Row(
                children: [
                  Expanded(
                    child: OutlinedButton(
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                        side: const BorderSide(color: TruxifyColors.border),
                      ),
                      onPressed: () => Navigator.pop(context),
                      child: Text(
                        'Dismiss',
                        style: GoogleFonts.dmSans(
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.secondaryText,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: PrimaryButton(
                      label: 'Calibrate Sensors',
                      onPressed: () {
                        Navigator.pop(context);
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(
                            content: Text('TPMS calibration command sent. Refreshing telemetry...'),
                            backgroundColor: TruxifyColors.success,
                          ),
                        );
                      },
                    ),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  Future<void> _showReportIssueSheet(BuildContext context) async {
    String selectedCategory = 'Engine';
    final descController = TextEditingController();
    bool isSubmitting = false;

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setSheetState) {
            return Padding(
              padding: EdgeInsets.fromLTRB(20, 10, 20, MediaQuery.of(context).viewInsets.bottom + 20),
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
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'Select Issue Category',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.secondaryText,
                    ),
                  ),
                  const SizedBox(height: 8),
                  DropdownButtonFormField<String>(
                    value: selectedCategory,
                    decoration: InputDecoration(
                      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: TruxifyColors.border),
                      ),
                    ),
                    items: ['Engine', 'Tyres', 'Brakes', 'Electricals', 'Documents', 'Other']
                        .map((cat) => DropdownMenuItem(value: cat, child: Text(cat, style: GoogleFonts.dmSans())))
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
                      color: TruxifyColors.secondaryText,
                    ),
                  ),
                  const SizedBox(height: 8),
                  TextField(
                    controller: descController,
                    maxLines: 3,
                    style: GoogleFonts.dmSans(fontSize: 14),
                    decoration: InputDecoration(
                      hintText: 'e.g. Squeaking sound from front brakes when slowing down...',
                      hintStyle: GoogleFonts.dmSans(color: TruxifyColors.hintText, fontSize: 13),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(12),
                        borderSide: const BorderSide(color: TruxifyColors.border),
                      ),
                    ),
                  ),
                  const SizedBox(height: 20),
                  isSubmitting
                      ? const Center(
                          child: Padding(
                            padding: EdgeInsets.all(12.0),
                            child: CircularProgressIndicator(color: TruxifyColors.accent),
                          ),
                        )
                      : PrimaryButton(
                          label: 'Submit Ticket',
                          onPressed: () async {
                            if (descController.text.trim().isEmpty) {
                              ScaffoldMessenger.of(context).showSnackBar(
                                const SnackBar(
                                  content: Text('Please enter an issue description'),
                                  backgroundColor: TruxifyColors.error,
                                ),
                              );
                              return;
                            }
                            final navigator = Navigator.of(context);
                            final messenger = ScaffoldMessenger.of(context);
                            setSheetState(() => isSubmitting = true);
                            
                            try {
                              final newTicket = await _truckRepository.createMaintenanceTicket(
                                truckId: _truck!.id,
                                driverId: _truck!.driverId,
                                category: selectedCategory,
                                description: descController.text.trim(),
                              );

                              if (!mounted) return;
                              setState(() {
                                _reportedIssues.insert(0, newTicket);
                              });
                              navigator.pop();
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('Maintenance ticket submitted successfully'),
                                  backgroundColor: TruxifyColors.success,
                                ),
                              );
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
            );
          },
        );
      },
    );
  }

  Future<void> _showDocumentPreview(BuildContext context, String title, DateTime? expiryDate) async {
    final formattedExpiry = expiryDate != null ? DateFormat('MMM yyyy').format(expiryDate) : 'Unknown';
    final isCompliant = expiryDate != null && expiryDate.isAfter(DateTime.now());

    await showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
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
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                    decoration: BoxDecoration(
                      color: isCompliant 
                          ? TruxifyColors.success.withOpacity(0.1)
                          : TruxifyColors.error.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      isCompliant ? 'ACTIVE' : 'EXPIRED',
                      style: GoogleFonts.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: isCompliant ? TruxifyColors.success : TruxifyColors.error,
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
                  color: TruxifyColors.secondaryBackground,
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: TruxifyColors.border),
                ),
                child: Column(
                  children: [
                    Icon(
                      isCompliant ? Icons.verified_user_rounded : Icons.gpp_bad_rounded, 
                      color: isCompliant ? TruxifyColors.success : TruxifyColors.error, 
                      size: 48
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Government Document',
                      style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText),
                    ),
                    Text(
                      'Issuer: Ministry of Road Transport & Highways',
                      style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.secondaryText),
                    ),
                    const SizedBox(height: 20),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Expiry Date:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(formattedExpiry, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Status:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(
                          isCompliant ? 'COMPLIANT' : 'EXPIRED', 
                          style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: isCompliant ? TruxifyColors.success : TruxifyColors.error)
                        ),
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
      return const Scaffold(
        backgroundColor: TruxifyColors.background,
        body: Center(child: CircularProgressIndicator(color: TruxifyColors.accent)),
      );
    }

    if (_errorMessage != null || _truck == null) {
      return Scaffold(
        backgroundColor: TruxifyColors.background,
        appBar: AppBar(
          backgroundColor: Colors.white,
          elevation: 0,
          leading: IconButton(
            icon: const Icon(Icons.arrow_back_rounded, color: TruxifyColors.primaryText),
            onPressed: () => Navigator.of(context).pop(),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24.0),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const Icon(Icons.directions_car_rounded, size: 64, color: TruxifyColors.hintText),
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
    final isEngineGood = truck.engineHealthPct >= 90.0;
    
    // Fallback formatters for dates
    final insFormat = truck.insuranceExpiry != null ? DateFormat('MMM yyyy').format(truck.insuranceExpiry!) : 'N/A';
    final pucFormat = truck.pucExpiry != null ? DateFormat('MMM yyyy').format(truck.pucExpiry!) : 'N/A';
    final permitFormat = truck.permitExpiry != null ? DateFormat('MMM yyyy').format(truck.permitExpiry!) : 'N/A';

    return Scaffold(
      backgroundColor: TruxifyColors.background,
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: TruxifyColors.primaryText),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Text(
          'My Truck Dashboard',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.bold,
            color: TruxifyColors.primaryText,
          ),
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.build_rounded, color: TruxifyColors.accent),
            tooltip: 'Report Issue',
            onPressed: () => _showReportIssueSheet(context),
          ),
        ],
        shape: const Border(bottom: BorderSide(color: TruxifyColors.border)),
      ),
      body: SafeArea(
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
                      color: TruxifyColors.accent.withOpacity(0.12),
                      blurRadius: 8,
                      offset: const Offset(0, 2),
                    )
                  ],
                ),
                padding: const EdgeInsets.all(20),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                          decoration: BoxDecoration(
                            color: Colors.white.withOpacity(0.15),
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            children: [
                              Container(
                                width: 6,
                                height: 6,
                                decoration: BoxDecoration(
                                  color: truck.tpmsConnected ? Colors.greenAccent : Colors.redAccent,
                                  shape: BoxShape.circle,
                                ),
                              ),
                              const SizedBox(width: 6),
                              Text(
                                truck.tpmsConnected ? 'Connected TPMS' : 'TPMS Offline',
                                style: GoogleFonts.dmSans(
                                  fontSize: 10,
                                  fontWeight: FontWeight.bold,
                                  color: Colors.white,
                                ),
                              ),
                            ],
                          ),
                        ),
                        Text(
                          truck.numberPlate,
                          style: GoogleFonts.robotoMono(
                            fontSize: 14,
                            fontWeight: FontWeight.bold,
                            color: Colors.white,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 16),
                    Text(
                      truck.name,
                      style: GoogleFonts.dmSans(
                        fontSize: 22,
                        fontWeight: FontWeight.bold,
                        color: Colors.white,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      'Max Capacity: ${truck.maxCapacityTons} Tons',
                      style: GoogleFonts.dmSans(
                        fontSize: 12,
                        color: Colors.white.withOpacity(0.7),
                      ),
                    ),
                    const SizedBox(height: 16),
                    const Divider(color: Colors.white24, height: 1),
                    const SizedBox(height: 16),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              'NEXT SERVICE IN',
                              style: GoogleFonts.dmSans(
                                fontSize: 9,
                                letterSpacing: 0.5,
                                color: Colors.white.withOpacity(0.5),
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              '4,200 km',
                              style: GoogleFonts.dmSans(
                                fontSize: 15,
                                fontWeight: FontWeight.bold,
                                color: Colors.white,
                              ),
                            ),
                          ],
                        ),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            'Schedule Service',
                            style: GoogleFonts.dmSans(
                              fontSize: 11,
                              fontWeight: FontWeight.bold,
                              color: TruxifyColors.accentDark,
                            ),
                          ),
                        ),
                      ],
                    ),
                  ],
                ),
              ),

              const SizedBox(height: 20),

              // Telemetry Header
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    'REAL-TIME TELEMETRY',
                    style: GoogleFonts.dmSans(
                      fontSize: 11,
                      letterSpacing: 0.8,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.secondaryText,
                    ),
                  ),
                  Text(
                    'Updated just now',
                    style: GoogleFonts.dmSans(
                      fontSize: 10,
                      color: TruxifyColors.hintText,
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 10),

              // Telemetry Grid
              GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 12,
                mainAxisSpacing: 12,
                childAspectRatio: 1.35,
                children: [
                  // Fuel Indicator
                  _buildTelemetryCard(
                    icon: Icons.local_gas_station_rounded,
                    title: 'Fuel Level',
                    value: '${truck.fuelLevelPct.toInt()}%',
                    subtitle: '${(truck.fuelLevelPct * 3.5).toInt()} Liters est.',
                    color: truck.fuelLevelPct > 20 ? TruxifyColors.accent : TruxifyColors.error,
                    progressBarFactor: truck.fuelLevelPct / 100.0,
                  ),

                  // Engine Health
                  _buildTelemetryCard(
                    icon: Icons.query_stats_rounded,
                    title: 'Engine Status',
                    value: isEngineGood ? '${truck.engineHealthPct.toInt()}%' : 'Needs Check',
                    subtitle: isEngineGood ? 'Optimal' : 'Check engine logs',
                    color: isEngineGood ? TruxifyColors.success : TruxifyColors.warning,
                    progressBarFactor: truck.engineHealthPct / 100.0,
                  ),

                  // Tyres Card
                  GestureDetector(
                    onTap: () => _showTyreDiagnostics(context),
                    child: _buildTelemetryCard(
                      icon: Icons.adjust_rounded,
                      title: 'Tyre Pressure',
                      value: '${truck.avgTyrePressurePsi.toStringAsFixed(1)} PSI',
                      subtitle: 'Average · Tap for wear logs',
                      color: truck.avgTyrePressurePsi >= 100 ? TruxifyColors.success : TruxifyColors.warning,
                      progressBarFactor: (truck.avgTyrePressurePsi / 120.0).clamp(0.0, 1.0),
                    ),
                  ),

                  // Oil Life (Derived mock or fallback)
                  _buildTelemetryCard(
                    icon: Icons.opacity_rounded,
                    title: 'Oil Quality',
                    value: '88%',
                    subtitle: 'Change in 8,500 km',
                    color: TruxifyColors.accent,
                    progressBarFactor: 0.88,
                  ),
                ],
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
                    color: TruxifyColors.secondaryText,
                  ),
                ),
                const SizedBox(height: 8),
                ..._reportedIssues.map((ticket) {
                  return AppCard(
                    margin: const EdgeInsets.only(bottom: 10),
                    padding: const EdgeInsets.all(12),
                    child: Row(
                      children: [
                        Container(
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: ticket.status.toLowerCase() == 'open'
                                ? TruxifyColors.warning.withOpacity(0.1)
                                : TruxifyColors.success.withOpacity(0.1),
                            shape: BoxShape.circle,
                          ),
                          child: Icon(
                            ticket.status.toLowerCase() == 'open'
                                ? Icons.error_outline_rounded
                                : Icons.check_circle_outline_rounded, 
                            color: ticket.status.toLowerCase() == 'open'
                                ? TruxifyColors.warning
                                : TruxifyColors.success, 
                            size: 18
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                children: [
                                  Text(
                                    ticket.category,
                                    style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 13),
                                  ),
                                  Text(
                                    ticket.status,
                                    style: GoogleFonts.robotoMono(
                                      fontSize: 10, 
                                      color: ticket.status.toLowerCase() == 'open' ? TruxifyColors.warning : TruxifyColors.success
                                    ),
                                  ),
                                ],
                              ),
                              const SizedBox(height: 2),
                              Text(
                                ticket.description,
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.secondaryText),
                              ),
                              if (ticket.createdAt != null) ...[
                                const SizedBox(height: 2),
                                Text(
                                  DateFormat('dd MMM, yyyy').format(ticket.createdAt!),
                                  style: GoogleFonts.dmSans(fontSize: 9, color: TruxifyColors.hintText),
                                )
                              ]
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                }),
                const SizedBox(height: 10),
              ],

              // 3. Official Specs & Certificates
              Text(
                'OFFICIAL SPECS & COMPLIANCE',
                style: GoogleFonts.dmSans(
                  fontSize: 11,
                  letterSpacing: 0.8,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.secondaryText,
                ),
              ),
              const SizedBox(height: 10),
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
                      onTap: () => _showDocumentPreview(context, 'Insurance Cover', truck.insuranceExpiry),
                    ),
                    const Divider(height: 1, color: TruxifyColors.border),
                    _buildSpecRow(
                      icon: Icons.eco_outlined,
                      label: 'Pollution Under Control',
                      value: 'Active (Expires $pucFormat)',
                      onTap: () => _showDocumentPreview(context, 'Pollution Certificate', truck.pucExpiry),
                    ),
                    const Divider(height: 1, color: TruxifyColors.border),
                    _buildSpecRow(
                      icon: Icons.card_membership_rounded,
                      label: 'National Carriage Permit',
                      value: 'Active (Expires $permitFormat)',
                      onTap: () => _showDocumentPreview(context, 'National Carriage Permit', truck.permitExpiry),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 30),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildTelemetryCard({
    required IconData icon,
    required String title,
    required String value,
    required String subtitle,
    required Color color,
    required double progressBarFactor,
  }) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: TruxifyColors.border),
        boxShadow: [
          BoxShadow(
            color: TruxifyColors.accent.withOpacity(0.04),
            blurRadius: 6,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                title,
                style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.secondaryText,
                ),
              ),
              Icon(icon, color: color, size: 18),
            ],
          ),
          const SizedBox(height: 4),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 16,
              fontWeight: FontWeight.bold,
              color: TruxifyColors.primaryText,
            ),
          ),
          const SizedBox(height: 4),
          Container(
            height: 4,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.grey.shade100,
              borderRadius: BorderRadius.circular(2),
            ),
            child: FractionallySizedBox(
              alignment: Alignment.centerLeft,
              widthFactor: progressBarFactor,
              child: Container(
                decoration: BoxDecoration(
                  color: color,
                  borderRadius: BorderRadius.circular(2),
                ),
              ),
            ),
          ),
          const SizedBox(height: 4),
          Text(
            subtitle,
            maxLines: 1,
            overflow: TextOverflow.ellipsis,
            style: GoogleFonts.dmSans(
              fontSize: 9,
              color: TruxifyColors.hintText,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildSpecRow({
    required IconData icon,
    required String label,
    required String value,
    VoidCallback? onTap,
  }) {
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        child: Row(
          children: [
            Icon(icon, size: 18, color: TruxifyColors.accentDark),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: GoogleFonts.dmSans(
                  fontSize: 12,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.primaryText,
                ),
              ),
            ),
            Text(
              value,
              style: GoogleFonts.dmSans(
                fontSize: 11,
                color: onTap != null ? TruxifyColors.accent : TruxifyColors.secondaryText,
                fontWeight: onTap != null ? FontWeight.bold : FontWeight.normal,
              ),
            ),
            if (onTap != null) ...[
              const SizedBox(width: 4),
              const Icon(Icons.arrow_forward_ios_rounded, color: TruxifyColors.accent, size: 10),
            ],
          ],
        ),
      ),
    );
  }
}
