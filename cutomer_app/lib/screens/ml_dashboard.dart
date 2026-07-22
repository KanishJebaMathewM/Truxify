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

  @override
  void initState() {
    super.initState();
    fetchMetrics();
  }

  Future<void> fetchMetrics() async {
    try {
      final response = await http.get(
        Uri.parse('http://ml-engine:8000/ab-testing/status'),
      );
      if (response.statusCode == 200) {
        setState(() {
          metrics = json.decode(response.body);
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

  Widget _buildMetricsCard() {
    final results = metrics?['results'] as Map<String, dynamic>? ?? {};
    final rows = <Widget>[];
    results.forEach((metric, values) {
      final prod = values['production']?.toStringAsFixed(2) ?? 'N/A';
      final shadow = values['shadow']?.toStringAsFixed(2) ?? 'N/A';
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
    final isBetter = lowerBetter 
        ? double.parse(shadow) < double.parse(prod)
        : double.parse(shadow) > double.parse(prod);
    
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
          final response = await http.post(
            Uri.parse('http://ml-engine:8000/ab-testing/rollback/$testId'),
          );
          if (response.statusCode == 200) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(content: Text('Rollback triggered successfully!')),
            );
            fetchMetrics();
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