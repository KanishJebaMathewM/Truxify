import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../theme/app_theme.dart';

class ProfitEstimatorCard extends StatelessWidget {
  final double estimatedRevenue;
  final double distanceKm;
  final double fuelEfficiencyKmpl;

  const ProfitEstimatorCard({
    super.key,
    required this.estimatedRevenue,
    required this.distanceKm,
    this.fuelEfficiencyKmpl = 10.0, // Default to 10 kmpl if not specified
  });

  @override
  Widget build(BuildContext context) {
    const double fuelPricePerLiter = 90.0; // Hardcoded estimate per issue spec
    
    // Core calculations
    final double litersNeeded = distanceKm / fuelEfficiencyKmpl;
    final double estimatedFuelCost = litersNeeded * fuelPricePerLiter;
    final double platformFee = estimatedRevenue * 0.05; // 5% fee
    final double netProfit = estimatedRevenue - estimatedFuelCost - platformFee;

    final formatCurrency = NumberFormat.currency(locale: 'en_IN', symbol: '₹', decimalDigits: 0);

    return Card(
      margin: const EdgeInsets.symmetric(vertical: 8.0),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Profit Estimator',
              style: Theme.of(context).textTheme.titleMedium?.copyWith(
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 16),
            _buildRow(
              context,
              'Gross Revenue',
              formatCurrency.format(estimatedRevenue),
              isBold: true,
            ),
            const SizedBox(height: 8),
            _buildRow(
              context,
              'Est. Fuel Cost (${fuelEfficiencyKmpl} km/l)',
              '-${formatCurrency.format(estimatedFuelCost)}',
              color: TruxifyColors.error,
            ),
            const SizedBox(height: 8),
            _buildRow(
              context,
              'Platform Fee (5%)',
              '-${formatCurrency.format(platformFee)}',
              color: TruxifyColors.error,
            ),
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 8.0),
              child: Divider(),
            ),
            _buildRow(
              context,
              'Net Profit',
              formatCurrency.format(netProfit),
              isBold: true,
              color: netProfit >= 0 ? TruxifyColors.success : TruxifyColors.errorRed,
              isLarge: true,
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildRow(
    BuildContext context,
    String label,
    String value, {
    bool isBold = false,
    Color? color,
    bool isLarge = false,
  }) {
    final style = TextStyle(
      fontWeight: isBold ? FontWeight.bold : FontWeight.normal,
      color: color ?? TruxifyColors.adaptiveSecondaryText(context),
      fontSize: isLarge ? 18.0 : 14.0,
    );

    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(
          label,
          style: style.copyWith(
            color: isLarge 
                ? (color ?? Theme.of(context).textTheme.bodyLarge?.color) 
                : TruxifyColors.adaptiveSecondaryText(context),
          ),
        ),
        Text(
          value,
          style: style,
        ),
      ],
    );
  }
}
