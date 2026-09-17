import 'package:flutter/material.dart';

class TripEarning {
  final String id;
  final DateTime date;
  final double gross;
  final double net;
  final double deductions;
  final int distance;

  TripEarning({
    required this.id,
    required this.date,
    required this.gross,
    required this.net,
    required this.deductions,
    required this.distance,
  });

  factory TripEarning.fromJson(Map<String, dynamic> json) => TripEarning(
        id: json['id'],
        date: DateTime.parse(json['date']),
        gross: (json['gross'] as num).toDouble(),
        net: (json['net'] as num).toDouble(),
        deductions: (json['deductions'] as num).toDouble(),
        distance: json['distance'] ?? 0,
      );
}

class EarningsDashboard extends StatefulWidget {
  const EarningsDashboard({super.key});

  @override
  State<EarningsDashboard> createState() => _EarningsDashboardState();
}

class _EarningsDashboardState extends State<EarningsDashboard> {
  String _selectedPeriod = 'monthly';

  // TODO: replace with real API call to GET /api/earnings/summary
  final Map<String, dynamic> _mockData = {
    'totalGross': 21500.0,
    'totalDeductions': 4300.0,
    'netEarnings': 17200.0,
    'tripCount': 2,
    'brokerSavingsPercent': 35,
    'trips': [
      {
        'id': 'trip_001',
        'date': DateTime.now().toIso8601String(),
        'gross': 12000.0,
        'net': 9700.0,
        'deductions': 2300.0,
        'distance': 420,
      },
      {
        'id': 'trip_002',
        'date': DateTime.now()
            .subtract(const Duration(days: 1))
            .toIso8601String(),
        'gross': 9500.0,
        'net': 7500.0,
        'deductions': 2000.0,
        'distance': 310,
      },
    ],
  };

  @override
  Widget build(BuildContext context) {
    final trips = (_mockData['trips'] as List)
        .map((t) => TripEarning.fromJson(t))
        .toList();

    return Scaffold(
      appBar: AppBar(
        title: const Text('My Earnings'),
        backgroundColor: const Color(0xFF1A1A2E),
        foregroundColor: Colors.white,
      ),
      backgroundColor: const Color(0xFFF5F5F5),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Period selector
            Row(
              children: ['monthly', 'weekly'].map((p) {
                final selected = _selectedPeriod == p;
                return Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: ChoiceChip(
                    label: Text(
                      p == 'monthly' ? 'This Month' : 'This Week',
                      style: TextStyle(
                        color: selected ? Colors.white : Colors.black87,
                      ),
                    ),
                    selected: selected,
                    selectedColor: const Color(0xFF16213E),
                    onSelected: (_) =>
                        setState(() => _selectedPeriod = p),
                  ),
                );
              }).toList(),
            ),
            const SizedBox(height: 16),

            // Summary card
            _SummaryCard(
              gross: _mockData['totalGross'],
              net: _mockData['netEarnings'],
              deductions: _mockData['totalDeductions'],
              tripCount: _mockData['tripCount'],
            ),
            const SizedBox(height: 16),

            // Broker savings highlight
            _BrokerSavingsCard(
                savingsPercent: _mockData['brokerSavingsPercent']),
            const SizedBox(height, height: 16),

            // Trip list
            const Text(
              'Trip Breakdown',
              style: TextStyle(
                fontSize: 18,
                fontWeight: FontWeight.bold,
              ),
            ),
            const SizedBox(height: 8),
            ...trips.map((t) => _TripCard(trip: t)),
          ],
        ),
      ),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  final double gross, net, deductions;
  final int tripCount;

  const _SummaryCard({
    required this.gross,
    required this.net,
    required this.deductions,
    required this.tripCount,
  });

  @override
  Widget build(BuildContext context) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      color: const Color(0xFF16213E),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Text(
              '₹${net.toStringAsFixed(0)}',
              style: const TextStyle(
                fontSize: 36,
                fontWeight: FontWeight.bold,
                color: Colors.greenAccent,
              ),
            ),
            const Text(
              'Net Earnings',
              style: TextStyle(color: Colors.white70),
            ),
            const Divider(color: Colors.white24, height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _StatItem(
                    label: 'Gross',
                    value: '₹${gross.toStringAsFixed(0)}',
                    color: Colors.white),
                _StatItem(
                    label: 'Deductions',
                    value: '₹${deductions.toStringAsFixed(0)}',
                    color: Colors.redAccent),
                _StatItem(
                    label: 'Trips',
                    value: '$tripCount',
                    color: Colors.lightBlueAccent),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  final String label, value;
  final Color color;
  const _StatItem(
      {required this.label, required this.value, required this.color});

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(value,
            style: TextStyle(
                color: color, fontSize: 16, fontWeight: FontWeight.bold)),
        Text(label,
            style: const TextStyle(color: Colors.white54, fontSize: 12)),
      ],
    );
  }
}

class _BrokerSavingsCard extends StatelessWidget {
  final int savingsPercent;
  const _BrokerSavingsCard({required this.savingsPercent});

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF0F3460),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(Icons.savings_outlined,
                color: Colors.greenAccent, size: 32),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'You saved $savingsPercent% vs broker commission this period!',
                style: const TextStyle(
                    color: Colors.white, fontWeight: FontWeight.w600),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _TripCard extends StatelessWidget {
  final TripEarning trip;
  const _TripCard({required this.trip});

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding:
            const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        leading: CircleAvatar(
          backgroundColor: const Color(0xFF16213E),
          child: Text(
            '${trip.distance}km',
            style: const TextStyle(color: Colors.white, fontSize: 10),
          ),
        ),
        title: Text(
          '₹${trip.net.toStringAsFixed(0)} net',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        subtitle: Text(
          'Gross ₹${trip.gross.toStringAsFixed(0)} · Deductions ₹${trip.deductions.toStringAsFixed(0)}\n'
          '${_formatDate(trip.date)}',
        ),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }

  String _formatDate(DateTime d) =>
      '${d.day}/${d.month}/${d.year}';
}