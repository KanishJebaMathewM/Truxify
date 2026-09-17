import 'package:flutter/material.dart';

import '../services/api_client.dart';

class TripEarning {
  final String id;
  final DateTime date;
  final double gross;
  final double net;
  final double deductions;
  final int distance;

  const TripEarning({
    required this.id,
    required this.date,
    required this.gross,
    required this.net,
    required this.deductions,
    required this.distance,
  });

  factory TripEarning.fromJson(Map<String, dynamic> json) {
    final dateValue = json['date']?.toString();
    final parsedDate = dateValue == null ? null : DateTime.tryParse(dateValue);
    if (parsedDate == null) {
      throw const FormatException('Invalid trip date in earnings response');
    }

    return TripEarning(
      id: json['id']?.toString() ?? '',
      date: parsedDate,
      gross: _asDouble(json['gross']),
      net: _asDouble(json['net']),
      deductions: _asDouble(json['deductions']),
      distance: _asInt(json['distance']),
    );
  }
}

double _asDouble(Object? value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

int _asInt(Object? value) {
  if (value is num) return value.toInt();
  return int.tryParse(value?.toString() ?? '') ?? 0;
}

class EarningsDashboard extends StatefulWidget {
  const EarningsDashboard({super.key, this.apiClient});

  final ApiClient? apiClient;

  @override
  State<EarningsDashboard> createState() => _EarningsDashboardState();
}

class _EarningsDashboardState extends State<EarningsDashboard> {
  String _selectedPeriod = 'monthly';
  Map<String, dynamic>? _summary;
  String? _errorMessage;
  bool _isLoading = true;
  late final ApiClient _apiClient;
  late final bool _ownsApiClient;

  @override
  void initState() {
    super.initState();
    _apiClient = widget.apiClient ?? ApiClient();
    _ownsApiClient = widget.apiClient == null;
    _loadEarnings();
  }

  @override
  void dispose() {
    if (_ownsApiClient) {
      _apiClient.dispose();
    }
    super.dispose();
  }

  Future<void> _loadEarnings() async {
    if (mounted) {
      setState(() {
        _isLoading = true;
        _errorMessage = null;
      });
    }

    try {
      final response = await _apiClient.get(
        '/api/earnings/summary?period=$_selectedPeriod',
      );

      if (response is! Map) {
        throw const FormatException('Invalid earnings summary response.');
      }

      final success = response['success'] == true;
      final data = response['data'];
      if (!success || data is! Map) {
        throw const FormatException('Invalid earnings summary payload.');
      }

      if (!mounted) return;
      setState(() {
        _summary = Map<String, dynamic>.from(data);
        _isLoading = false;
        _errorMessage = null;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _isLoading = false;
        _errorMessage = _friendlyError(error);
      });
    }
  }

  String _friendlyError(Object error) {
    if (error is ApiException && error.message.isNotEmpty) {
      return error.message;
    }
    if (error is ApiAuthException) {
      return error.message;
    }
    if (error is FormatException && error.message.isNotEmpty) {
      return error.message;
    }
    return 'Unable to load your earnings right now. Please try again.';
  }

  List<TripEarning> get _trips {
    final rawTrips = _summary?['trips'];
    if (rawTrips is! List) return const [];

    final trips = <TripEarning>[];
    for (final rawTrip in rawTrips) {
      if (rawTrip is! Map) continue;
      try {
        trips.add(TripEarning.fromJson(Map<String, dynamic>.from(rawTrip)));
      } on FormatException {
        // Ignore malformed rows so one bad trip cannot break the dashboard.
      }
    }
    return trips;
  }

  double get _totalGross => _asDouble(_summary?['totalGross']);
  double get _totalDeductions => _asDouble(_summary?['totalDeductions']);
  double get _netEarnings => _asDouble(_summary?['netEarnings']);
  int get _tripCount => _asInt(_summary?['tripCount']);
  int get _brokerSavingsPercent => _asInt(_summary?['brokerSavingsPercent']);

  void _changePeriod(String period) {
    if (period == _selectedPeriod) return;
    setState(() => _selectedPeriod = period);
    _loadEarnings();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('My Earnings'),
        backgroundColor: const Color(0xFF1A1A2E),
        foregroundColor: Colors.white,
        actions: [
          IconButton(
            tooltip: 'Refresh earnings',
            onPressed: _isLoading ? null : _loadEarnings,
            icon: const Icon(Icons.refresh),
          ),
        ],
      ),
      backgroundColor: const Color(0xFFF5F5F5),
      body: RefreshIndicator(
        onRefresh: _loadEarnings,
        child: _buildBody(),
      ),
    );
  }

  Widget _buildBody() {
    if (_isLoading) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _PeriodSelector(
            selectedPeriod: _selectedPeriod,
            onChanged: _changePeriod,
          ),
          const SizedBox(height: 32),
          const Center(child: CircularProgressIndicator()),
          const SizedBox(height: 32),
        ],
      );
    }

    if (_errorMessage != null) {
      return ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.all(16),
        children: [
          _PeriodSelector(
            selectedPeriod: _selectedPeriod,
            onChanged: _changePeriod,
          ),
          const SizedBox(height: 56),
          const Icon(Icons.cloud_off_outlined, size: 48),
          const SizedBox(height: 12),
          const Center(
            child: Text(
              'Couldn\'t load earnings',
              style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 8),
          Center(
            child: Text(
              _errorMessage!,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 20),
          Center(
            child: OutlinedButton.icon(
              onPressed: _loadEarnings,
              icon: const Icon(Icons.refresh),
              label: const Text('Retry'),
            ),
          ),
        ],
      );
    }

    final trips = _trips;

    return ListView(
      physics: const AlwaysScrollableScrollPhysics(),
      padding: const EdgeInsets.all(16),
      children: [
        _PeriodSelector(
          selectedPeriod: _selectedPeriod,
          onChanged: _changePeriod,
        ),
        const SizedBox(height: 16),
        _SummaryCard(
          gross: _totalGross,
          net: _netEarnings,
          deductions: _totalDeductions,
          tripCount: _tripCount,
        ),
        const SizedBox(height: 16),
        _BrokerSavingsCard(savingsPercent: _brokerSavingsPercent),
        const SizedBox(height: 20),
        const Text(
          'Trip Breakdown',
          style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
        ),
        const SizedBox(height: 8),
        if (trips.isEmpty)
          const _EmptyTripsCard()
        else
          ...trips.map((trip) => _TripCard(trip: trip)),
      ],
    );
  }
}

class _PeriodSelector extends StatelessWidget {
  const _PeriodSelector({
    required this.selectedPeriod,
    required this.onChanged,
  });

  final String selectedPeriod;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: ['monthly', 'weekly'].map((period) {
        final selected = selectedPeriod == period;
        return Padding(
          padding: const EdgeInsets.only(right: 8),
          child: ChoiceChip(
            label: Text(
              period == 'monthly' ? 'This Month' : 'This Week',
              style: TextStyle(
                color: selected ? Colors.white : Colors.black87,
              ),
            ),
            selected: selected,
            selectedColor: const Color(0xFF16213E),
            onSelected: (_) => onChanged(period),
          ),
        );
      }).toList(),
    );
  }
}

class _SummaryCard extends StatelessWidget {
  const _SummaryCard({
    required this.gross,
    required this.net,
    required this.deductions,
    required this.tripCount,
  });

  final double gross;
  final double net;
  final double deductions;
  final int tripCount;

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
                  color: Colors.white,
                ),
                _StatItem(
                  label: 'Deductions',
                  value: '₹${deductions.toStringAsFixed(0)}',
                  color: Colors.redAccent,
                ),
                _StatItem(
                  label: 'Trips',
                  value: '$tripCount',
                  color: Colors.lightBlueAccent,
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _StatItem extends StatelessWidget {
  const _StatItem({
    required this.label,
    required this.value,
    required this.color,
  });

  final String label;
  final String value;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Text(
          value,
          style: TextStyle(
            color: color,
            fontSize: 16,
            fontWeight: FontWeight.bold,
          ),
        ),
        Text(
          label,
          style: const TextStyle(color: Colors.white54, fontSize: 12),
        ),
      ],
    );
  }
}

class _BrokerSavingsCard extends StatelessWidget {
  const _BrokerSavingsCard({required this.savingsPercent});

  final int savingsPercent;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: const Color(0xFF0F3460),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            const Icon(
              Icons.savings_outlined,
              color: Colors.greenAccent,
              size: 32,
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                'You saved $savingsPercent% vs broker commission this period!',
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _EmptyTripsCard extends StatelessWidget {
  const _EmptyTripsCard();

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: const [
            Icon(Icons.local_shipping_outlined, size: 40),
            SizedBox(height: 10),
            Text(
              'No completed trips yet',
              style: TextStyle(fontWeight: FontWeight.w600),
            ),
            SizedBox(height: 4),
            Text('Completed trips for this period will appear here.'),
          ],
        ),
      ),
    );
  }
}

class _TripCard extends StatelessWidget {
  const _TripCard({required this.trip});

  final TripEarning trip;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 10),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 8,
        ),
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
          'Gross ₹${trip.gross.toStringAsFixed(0)} · '
          'Deductions ₹${trip.deductions.toStringAsFixed(0)}\n'
          '${_formatDate(trip.date)}',
        ),
        trailing: const Icon(Icons.chevron_right),
      ),
    );
  }

  String _formatDate(DateTime date) => '${date.day}/${date.month}/${date.year}';
}
