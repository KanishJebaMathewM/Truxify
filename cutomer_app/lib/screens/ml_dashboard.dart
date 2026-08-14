import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'dart:convert';

class MLDashboard extends StatefulWidget {
  @override
  _MLDashboardState createState() => _MLDashboardState();
}

class _MLDashboardState extends State<MLDashboard> {
  Map<String, dynamic>? metrics;
  bool isLoading = true;

  static const String _baseUrl = String.fromEnvironment(
    'ML_ENGINE_URL',
    defaultValue: 'http://localhost:8000',
  );

  static const String _apiKey = String.fromEnvironment('ML_API_KEY');

  Map<String, String> _headers() => {
    if (_apiKey.isNotEmpty) 'X-API-Key': _apiKey,
  };

  @override
  void initState() {
    super.initState();
    fetchMetrics();
  }

  Future<void> fetchMetrics() async {
    try {
      final response = await http.get(
        Uri.parse('$_baseUrl/ab-testing/status'),
        headers: _headers(),
      );
      if (response.statusCode == 200) {
        setState(() {
          metrics = json.decode(response.body);
          isLoading = false;
        });
      } else {
        setState(() {
          isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('ML Model Performance')),
      body: isLoading 
        ? Center(child: CircularProgressIndicator())
        : Padding(
            padding: EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                _buildStatusCard(),
                SizedBox(height: 20),
                _buildMetricsCard(),
                SizedBox(height: 20),
                _buildRollbackButton(),
              ],
            ),
          ),
    );
  }

  Widget _buildStatusCard() {
    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('📊 A/B Test Status', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            SizedBox(height: 8),
            Text('Traffic Split: 10% / 90%'),
            Text('Active Test: ${metrics?['active_test']?['test_id'] ?? 'None'}'),
            Text('Production: ${metrics?['active_test']?['production_version'] ?? 'N/A'}'),
            Text('Shadow: ${metrics?['active_test']?['shadow_version'] ?? 'N/A'}'),
          ],
        ),
      ),
    );
  }

  /// Safely coerce a metric value (num, or a JSON string such as "0.95")
  /// into a double. Returns null when the value is missing or unparsable so
  /// the dashboard can skip it instead of crashing.
  double? _toDouble(dynamic value) {
    if (value is num) return value.toDouble();
    if (value == null) return null;
    return double.tryParse(value.toString());
  }

  Widget _buildMetricsCard() {
    final rawResults = metrics?['results'];
    final Map<String, dynamic> results;
    if (rawResults is Map) {
      results = Map<String, dynamic>.from(rawResults);
    } else {
      // `results` may arrive as a list (or any other shape) on some
      // responses; treat anything that is not a map as "no metrics".
      results = {};
    }

    final rows = <Widget>[];
    results.forEach((metric, values) {
      if (values is! Map) return;
      final prod = _toDouble(values['production'])?.toStringAsFixed(2);
      final shadow = _toDouble(values['shadow'])?.toStringAsFixed(2);
      if (prod == null || shadow == null) return;
      rows.add(_buildMetricRow(metric, prod, shadow, metric == 'rmse'));
    });

    if (rows.isEmpty) {
      rows.add(Text('No metrics available'));
    }

    return Card(
      child: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('📈 Performance Metrics', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            SizedBox(height: 8),
            ...rows,
          ],
        ),
      ),
    );
  }

  Widget _buildMetricRow(String metric, String prod, String shadow, bool lowerBetter) {
    final prodVal = double.tryParse(prod);
    final shadowVal = double.tryParse(shadow);
    final isBetter = prodVal != null && shadowVal != null
        ? (lowerBetter ? shadowVal < prodVal : shadowVal > prodVal)
        : false;
    
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(metric)),
          Expanded(child: Text('Prod: $prod')),
          Expanded(child: Text('Shadow: $shadow')),
          Icon(
            isBetter ? Icons.arrow_upward : Icons.arrow_downward,
            color: isBetter ? Colors.green : Colors.red,
          ),
        ],
      ),
    );
  }

  Widget _buildRollbackButton() {
    return ElevatedButton(
      onPressed: () async {
        // Trigger manual rollback
        final testId = metrics?['active_test']?['test_id'];
        if (testId != null) {
          try {
            final response = await http.post(
              Uri.parse('$_baseUrl/ab-testing/rollback/$testId'),
              headers: _headers(),
            );
            if (response.statusCode == 200) {
              ScaffoldMessenger.of(context).showSnackBar(
                SnackBar(content: Text('Rollback triggered successfully!')),
              );
              fetchMetrics();
            }
          } catch (e) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Rollback failed: $e')),
            );
          }
        }
      },
      style: ElevatedButton.styleFrom(
        backgroundColor: Colors.red,
        minimumSize: Size(double.infinity, 50),
      ),
      child: Text('🔄 Trigger Manual Rollback', style: TextStyle(color: Colors.white)),
    );
  }
}