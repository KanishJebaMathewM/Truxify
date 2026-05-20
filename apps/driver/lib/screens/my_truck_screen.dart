import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../data/mock_data.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class MyTruckScreen extends StatefulWidget {
  const MyTruckScreen({super.key});

  @override
  State<MyTruckScreen> createState() => _MyTruckScreenState();
}

class _MyTruckScreenState extends State<MyTruckScreen> {
  bool _isEngineGood = true;
  double _fuelLevel = 0.74; // 74%
  double _oilLife = 0.88; // 88%
  final List<Map<String, String>> _reportedIssues = [];

  // Tyre pressure data
  final Map<String, double> _tyrePressures = {
    'Front Left': 110.0,
    'Front Right': 108.0,
    'Rear Outer Left': 115.0,
    'Rear Inner Left': 114.0,
    'Rear Outer Right': 116.0,
    'Rear Inner Right': 115.0,
  };

  Future<void> _showTyreDiagnostics(BuildContext context) async {
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
                      color: TruxifyColors.success.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      'All Optimal',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.success,
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
                  ..._tyrePressures.entries.map((entry) {
                    final psi = entry.value;
                    final isGood = psi >= 105 && psi <= 120;
                    return TableRow(
                      children: [
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(entry.key, style: GoogleFonts.dmSans(fontSize: 13)),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(psi.toStringAsFixed(0), style: GoogleFonts.dmSans(fontSize: 13, fontWeight: FontWeight.bold)),
                        ),
                        Padding(
                          padding: const EdgeInsets.all(12.0),
                          child: Text(
                            isGood ? 'Optimal' : 'Needs Check',
                            style: GoogleFonts.dmSans(
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              color: isGood ? TruxifyColors.success : TruxifyColors.warning,
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
                          onPressed: () {
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
                            Future.delayed(const Duration(milliseconds: 1200), () {
                              if (!mounted) return;
                              setState(() {
                                _reportedIssues.add({
                                  'id': 'TKT-${1000 + _reportedIssues.length}',
                                  'category': selectedCategory,
                                  'description': descController.text.trim(),
                                  'status': 'Under Review',
                                  'date': 'Today',
                                });
                                if (selectedCategory == 'Engine') {
                                  _isEngineGood = false;
                                }
                              });
                              navigator.pop();
                              messenger.showSnackBar(
                                const SnackBar(
                                  content: Text('Maintenance ticket submitted successfully'),
                                  backgroundColor: TruxifyColors.success,
                                ),
                              );
                            });
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

  Future<void> _showDocumentPreview(BuildContext context, String title, String issueDate, String expiryDate) async {
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
                      color: TruxifyColors.success.withOpacity(0.1),
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Text(
                      'ACTIVE',
                      style: GoogleFonts.dmSans(
                        fontSize: 10,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.success,
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
                    const Icon(Icons.verified_user_rounded, color: TruxifyColors.success, size: 48),
                    const SizedBox(height: 12),
                    Text(
                      'Verified Government Document',
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
                        Text('Issued On:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(issueDate, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Expiry Date:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text(expiryDate, style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.primaryText)),
                      ],
                    ),
                    const Divider(height: 16, color: TruxifyColors.border),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceBetween,
                      children: [
                        Text('Status:', style: GoogleFonts.dmSans(fontSize: 12, color: TruxifyColors.hintText)),
                        Text('COMPLIANT', style: GoogleFonts.dmSans(fontSize: 12, fontWeight: FontWeight.bold, color: TruxifyColors.success)),
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
                              decoration: const BoxDecoration(
                                color: Colors.greenAccent,
                                shape: BoxShape.circle,
                              ),
                            ),
                            const SizedBox(width: 6),
                            Text(
                              'Connected TPMS',
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
                        driverTruckNumber,
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
                    driverTruck,
                    style: GoogleFonts.dmSans(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    'BharatBenz Multi-axle Heavy Carrier',
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
                  'Updated 1m ago',
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
                  value: '${(_fuelLevel * 100).toInt()}%',
                  subtitle: '280 Liters (850km range)',
                  color: TruxifyColors.accent,
                  progressBarFactor: _fuelLevel,
                ),

                // Engine Health
                _buildTelemetryCard(
                  icon: Icons.query_stats_rounded,
                  title: 'Engine Status',
                  value: _isEngineGood ? '98%' : 'Needs Check',
                  subtitle: _isEngineGood ? 'Temp: 82°C (Optimal)' : 'Check category engine logs',
                  color: _isEngineGood ? TruxifyColors.success : TruxifyColors.warning,
                  progressBarFactor: _isEngineGood ? 0.98 : 0.45,
                ),

                // Tyres Card
                GestureDetector(
                  onTap: () => _showTyreDiagnostics(context),
                  child: _buildTelemetryCard(
                    icon: Icons.adjust_rounded,
                    title: 'Tyre Pressure',
                    value: '115 PSI',
                    subtitle: 'Average · Tap for wear logs',
                    color: TruxifyColors.success,
                    progressBarFactor: 0.95,
                  ),
                ),

                // Oil Life
                _buildTelemetryCard(
                  icon: Icons.opacity_rounded,
                  title: 'Oil Quality',
                  value: '${(_oilLife * 100).toInt()}%',
                  subtitle: 'Change in 8,500 km',
                  color: TruxifyColors.accent,
                  progressBarFactor: _oilLife,
                ),
              ],
            ),

            const SizedBox(height: 20),

            // Active maintenance tickets
            if (_reportedIssues.isNotEmpty) ...[
              Text(
                'ACTIVE MAINTENANCE TICKETS',
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
                          color: TruxifyColors.warning.withOpacity(0.1),
                          shape: BoxShape.circle,
                        ),
                        child: const Icon(Icons.error_outline_rounded, color: TruxifyColors.warning, size: 18),
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
                                  ticket['category']!,
                                  style: GoogleFonts.dmSans(fontWeight: FontWeight.bold, fontSize: 13),
                                ),
                                Text(
                                  ticket['id']!,
                                  style: GoogleFonts.robotoMono(fontSize: 10, color: TruxifyColors.hintText),
                                ),
                              ],
                            ),
                            const SizedBox(height: 2),
                            Text(
                              ticket['description']!,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: GoogleFonts.dmSans(fontSize: 11, color: TruxifyColors.secondaryText),
                            ),
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
                    value: '25.0 Tons',
                  ),
                  const Divider(height: 1, color: TruxifyColors.border),
                  _buildSpecRow(
                    icon: Icons.aspect_ratio_rounded,
                    label: 'Cargo Bed Dimensions',
                    value: '32 ft × 8 ft × 10 ft',
                  ),
                  const Divider(height: 1, color: TruxifyColors.border),
                  _buildSpecRow(
                    icon: Icons.verified_user_outlined,
                    label: 'Insurance Cover',
                    value: 'Active (Expires Oct 2026)',
                    onTap: () => _showDocumentPreview(context, 'Insurance Cover', 'Oct 2023', 'Oct 2026'),
                  ),
                  const Divider(height: 1, color: TruxifyColors.border),
                  _buildSpecRow(
                    icon: Icons.eco_outlined,
                    label: 'Pollution Under Control',
                    value: 'Active (Expires Aug 2026)',
                    onTap: () => _showDocumentPreview(context, 'Pollution Certificate', 'Aug 2025', 'Aug 2026'),
                  ),
                  const Divider(height: 1, color: TruxifyColors.border),
                  _buildSpecRow(
                    icon: Icons.card_membership_rounded,
                    label: 'National Carriage Permit',
                    value: 'Active (Expires Dec 2027)',
                    onTap: () => _showDocumentPreview(context, 'National Carriage Permit', 'Dec 2022', 'Dec 2027'),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 30),
          ],
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
