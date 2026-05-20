import 'dart:math';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';
import '../theme/app_theme.dart';
import '../models/app_models.dart';
import '../widgets/common_widgets.dart';

class TripDetailScreen extends StatelessWidget {
  final Trip trip;

  const TripDetailScreen({super.key, required this.trip});

  void _showBlockchainBottomSheet(BuildContext context) {
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) {
        return Padding(
          padding: EdgeInsets.only(
            left: 16,
            right: 16,
            top: 12,
            bottom: MediaQuery.of(context).viewInsets.bottom + 16,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Center(child: BottomSheetHandle()),
              const SizedBox(height: 16),
              Center(
                child: Text(
                  'BLOCKCHAIN RECEIPT',
                  style: GoogleFonts.dmSans(
                    fontSize: 11,
                    fontWeight: FontWeight.bold,
                    color: TruxifyColors.hintText,
                    letterSpacing: 0.5,
                  ),
                ),
              ),
              const SizedBox(height: 16),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: const Color(0xFFF5F5F5),
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'Trip',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        color: TruxifyColors.hintText,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      trip.route,
                      style: GoogleFonts.dmSans(
                        fontSize: 14,
                        fontWeight: FontWeight.bold,
                        color: TruxifyColors.primaryText,
                      ),
                    ),
                    const SizedBox(height: 12),
                    Text(
                      'Hash',
                      style: GoogleFonts.dmSans(
                        fontSize: 11,
                        color: TruxifyColors.hintText,
                      ),
                    ),
                    const SizedBox(height: 2),
                    SelectableText(
                      trip.hash,
                      style: GoogleFonts.robotoMono(
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                        color: TruxifyColors.accent,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 16),
              Center(
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 6),
                  decoration: BoxDecoration(
                    color: TruxifyColors.accentLight,
                    borderRadius: BorderRadius.circular(20),
                  ),
                  child: Text(
                    '✓ Verified on Polygon',
                    style: GoogleFonts.dmSans(
                      fontSize: 12,
                      fontWeight: FontWeight.w500,
                      color: TruxifyColors.accent,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 20),
              SizedBox(
                width: double.infinity,
                height: 48,
                child: OutlinedButton(
                  onPressed: () => Navigator.pop(context),
                  style: OutlinedButton.styleFrom(
                    side: const BorderSide(color: TruxifyColors.border),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                    ),
                  ),
                  child: Text(
                    'Close',
                    style: GoogleFonts.dmSans(
                      color: TruxifyColors.primaryText,
                      fontWeight: FontWeight.w600,
                      fontSize: 14,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
            ],
          ),
        );
      },
    );
  }

  Widget _buildPaymentRow(String label, String value, {bool isHeader = false}) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              color: TruxifyColors.hintText,
            ),
          ),
          Text(
            value,
            style: GoogleFonts.dmSans(
              fontSize: 13,
              fontWeight: isHeader ? FontWeight.bold : FontWeight.w500,
              color: isHeader ? TruxifyColors.primaryText : TruxifyColors.primaryText,
            ),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final breakdown = trip.paymentBreakdown;

    // Extract start and end cities
    final cities = trip.route.split('→');
    final startCity = cities.isNotEmpty ? cities[0].trim() : 'Start';
    final endCity = cities.length > 1 ? cities[1].trim() : 'End';

    final startLetter = startCity.isNotEmpty ? startCity[0] : 'S';
    final endLetter = endCity.isNotEmpty ? endCity[0] : 'D';

    return Scaffold(
      backgroundColor: const Color(0xFFF7F3F3),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        leading: const BackButton(color: TruxifyColors.primaryText),
        title: Text(
          'Trip Details',
          style: GoogleFonts.dmSans(
            fontSize: 16,
            fontWeight: FontWeight.w600,
            color: TruxifyColors.primaryText,
          ),
        ),
        actions: [
          Center(
            child: Padding(
              padding: const EdgeInsets.only(right: 16),
              child: Text(
                trip.tripId,
                style: GoogleFonts.dmSans(
                  fontSize: 12,
                  color: TruxifyColors.hintText,
                  fontWeight: FontWeight.w500,
                ),
              ),
            ),
          ),
        ],
        shape: const Border(
          bottom: BorderSide(color: TruxifyColors.border, width: 1),
        ),
      ),
      body: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // 1. Route Hero Card
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(20),
              decoration: const BoxDecoration(
                gradient: LinearGradient(
                  colors: [TruxifyColors.accent, Color(0xFF5E0B0B)],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    trip.route,
                    style: GoogleFonts.dmSans(
                      color: Colors.white,
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    trip.date,
                    style: GoogleFonts.dmSans(
                      color: Colors.white.withOpacity(0.7),
                      fontSize: 12,
                    ),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceEvenly,
                    children: [
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.distance,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Distance',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 28,
                        color: Colors.white.withOpacity(0.15),
                      ),
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.duration,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Duration',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                      Container(
                        width: 1,
                        height: 28,
                        color: Colors.white.withOpacity(0.15),
                      ),
                      Expanded(
                        child: Column(
                          children: [
                            Text(
                              trip.earnings,
                              style: GoogleFonts.dmSans(
                                color: Colors.white,
                                fontSize: 14,
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              'Earnings',
                              style: GoogleFonts.dmSans(
                                color: Colors.white.withOpacity(0.5),
                                fontSize: 10,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // 2. Map Section
            Container(
              margin: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(16),
                border: Border.all(color: TruxifyColors.border),
              ),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                child: Column(
                  children: [
                    Container(
                      height: 180,
                      color: const Color(0xFFF0E8E8),
                      child: Stack(
                        children: [
                          // Grid pattern or subtle details could be added here, let's make a styled layout
                          // Route line (dashed)
                          Positioned(
                            left: 50,
                            right: 50,
                            top: 80,
                            height: 2,
                            child: Row(
                              children: List.generate(
                                20,
                                (index) => Expanded(
                                  child: Container(
                                    color: index % 2 == 0
                                        ? TruxifyColors.accent
                                        : Colors.transparent,
                                    height: 2,
                                  ),
                                ),
                              ),
                            ),
                          ),
                          // Start Circle (S)
                          Positioned(
                            left: 30,
                            top: 64,
                            child: Column(
                              children: [
                                Container(
                                  width: 32,
                                  height: 32,
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: TruxifyColors.accent,
                                  ),
                                  child: Center(
                                    child: Text(
                                      startLetter,
                                      style: GoogleFonts.dmSans(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  startCity,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 10,
                                    color: TruxifyColors.hintText,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // End Circle (J)
                          Positioned(
                            right: 30,
                            top: 64,
                            child: Column(
                              children: [
                                Container(
                                  width: 32,
                                  height: 32,
                                  decoration: const BoxDecoration(
                                    shape: BoxShape.circle,
                                    color: TruxifyColors.success,
                                  ),
                                  child: Center(
                                    child: Text(
                                      endLetter,
                                      style: GoogleFonts.dmSans(
                                        color: Colors.white,
                                        fontSize: 12,
                                        fontWeight: FontWeight.bold,
                                      ),
                                    ),
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  endCity,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 10,
                                    color: TruxifyColors.hintText,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          // Truck indicator in the middle
                          const Positioned(
                            left: 0,
                            right: 0,
                            top: 62,
                            child: Center(
                              child: Text(
                                '🚛',
                                style: TextStyle(fontSize: 20),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    // Map CTA Button
                    Padding(
                      padding: const EdgeInsets.all(12.0),
                      child: InkWell(
                        onTap: () {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(
                              content: Text('Opening route in Google Maps...'),
                            ),
                          );
                        },
                        borderRadius: BorderRadius.circular(10),
                        child: Container(
                          width: double.infinity,
                          padding: const EdgeInsets.symmetric(vertical: 12),
                          decoration: BoxDecoration(
                            color: TruxifyColors.accent,
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Row(
                            mainAxisAlignment: MainAxisAlignment.center,
                            children: [
                              const Icon(
                                Icons.map_outlined,
                                color: Colors.white,
                                size: 16,
                              ),
                              const SizedBox(width: 8),
                              Text(
                                'View Full Route on Google Maps',
                                style: GoogleFonts.dmSans(
                                  color: Colors.white,
                                  fontWeight: FontWeight.w600,
                                  fontSize: 13,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),

            // 3. Items Section
            Padding(
              padding: const EdgeInsets.only(left: 16, right: 16, top: 12, bottom: 8),
              child: Text(
                'ITEMS IN THIS TRIP',
                style: GoogleFonts.dmSans(
                  fontSize: 11,
                  fontWeight: FontWeight.bold,
                  color: TruxifyColors.hintText,
                  letterSpacing: 0.5,
                ),
              ),
            ),

            if (trip.tripItems.isEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: 16.0),
                child: Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(16),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: TruxifyColors.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Center(
                    child: Text(
                      'No items declared',
                      style: GoogleFonts.dmSans(
                        color: TruxifyColors.hintText,
                        fontSize: 13,
                      ),
                    ),
                  ),
                ),
              )
            else
              ...trip.tripItems.map((item) {
                return Container(
                  margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                  decoration: BoxDecoration(
                    color: Colors.white,
                    border: Border.all(color: TruxifyColors.border),
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          shape: BoxShape.circle,
                          color: item.delivered
                              ? TruxifyColors.success
                              : TruxifyColors.errorRed,
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              item.customerName,
                              style: GoogleFonts.dmSans(
                                fontSize: 13,
                                fontWeight: FontWeight.w500,
                                color: TruxifyColors.primaryText,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Row(
                              children: [
                                Text(
                                  item.goods,
                                  style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.hintText,
                                  ),
                                ),
                                Text(
                                  ' → ${item.destination}',
                                  style: GoogleFonts.dmSans(
                                    fontSize: 11,
                                    color: TruxifyColors.accent,
                                    fontWeight: FontWeight.w500,
                                  ),
                                ),
                              ],
                            ),
                          ],
                        ),
                      ),
                      Text(
                        item.earnings,
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    ],
                  ),
                );
              }),

            // 4. Payment Breakdown
            Container(
              margin: const EdgeInsets.all(16),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: TruxifyColors.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Payment Breakdown',
                    style: GoogleFonts.dmSans(
                      fontSize: 14,
                      fontWeight: FontWeight.bold,
                      color: TruxifyColors.primaryText,
                    ),
                  ),
                  const SizedBox(height: 12),
                  _buildPaymentRow('Base freight', breakdown?.baseFreight ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow('Fuel deducted', breakdown?.fuelDeducted ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow('Toll deducted', breakdown?.tollDeducted ?? '₹0'),
                  const Divider(color: TruxifyColors.border),
                  _buildPaymentRow('Platform fee', breakdown?.platformFee ?? '₹0'),
                  const Divider(thickness: 1.5, color: TruxifyColors.border),
                  const SizedBox(height: 4),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text(
                        'Net earnings',
                        style: GoogleFonts.dmSans(
                          fontSize: 13,
                          color: TruxifyColors.hintText,
                        ),
                      ),
                      Text(
                        breakdown?.netEarnings ?? '₹0',
                        style: GoogleFonts.dmSans(
                          fontSize: 16,
                          fontWeight: FontWeight.bold,
                          color: TruxifyColors.accent,
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),

            // 5. Blockchain Receipt
            Container(
              margin: const EdgeInsets.only(left: 16, right: 16, bottom: 24),
              padding: const EdgeInsets.all(14),
              decoration: BoxDecoration(
                color: Colors.white,
                border: Border.all(color: TruxifyColors.border),
                borderRadius: BorderRadius.circular(16),
              ),
              child: GestureDetector(
                onTap: () => _showBlockchainBottomSheet(context),
                behavior: HitTestBehavior.opaque,
                child: Row(
                  children: [
                    Container(
                      width: 36,
                      height: 36,
                      decoration: const BoxDecoration(
                        shape: BoxShape.circle,
                        color: TruxifyColors.accentLight,
                      ),
                      child: const Center(
                        child: Icon(
                          Icons.shield_outlined,
                          color: TruxifyColors.accent,
                          size: 18,
                        ),
                      ),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Blockchain Receipt',
                            style: GoogleFonts.dmSans(
                              fontSize: 14,
                              fontWeight: FontWeight.w500,
                              color: TruxifyColors.primaryText,
                            ),
                          ),
                          Text(
                            'Verified on Polygon · ${trip.hash.substring(0, min(18, trip.hash.length))}',
                            style: GoogleFonts.robotoMono(
                              fontSize: 11,
                              color: TruxifyColors.hintText,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(
                      Icons.chevron_right,
                      color: Color(0xFFCCBBBB),
                      size: 22,
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
