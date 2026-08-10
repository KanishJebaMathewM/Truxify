import 'package:flutter/material.dart';
import '../models/turnover_prediction_model.dart';
import '../services/sentiment_analysis_service.dart';

class RetentionDashboardScreen extends StatefulWidget {
  const RetentionDashboardScreen({super.key});

  @override
  State<RetentionDashboardScreen> createState() => _RetentionDashboardScreenState();
}

class _RetentionDashboardScreenState extends State<RetentionDashboardScreen> {
  final SentimentAnalysisService _sentimentService = SentimentAnalysisService();
  List<DriverChurnRisk> _atRiskDrivers = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final data = await _sentimentService.getAtRiskDrivers();
    if (mounted) {
      setState(() {
        _atRiskDrivers = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Retention AI'),
        backgroundColor: Colors.deepPurple[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildSummaryHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _atRiskDrivers.length,
                    itemBuilder: (context, index) {
                      return _buildRiskCard(_atRiskDrivers[index]);
                    },
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildSummaryHeader() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Fleet Health', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.warning, color: Colors.red[700]),
                  const SizedBox(width: 8),
                  const Text('3 Drivers at Risk', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                ],
              )
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('Estimated Cost to Replace', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Text('\$24,500', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.deepPurple[900])),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildRiskCard(DriverChurnRisk driver) {
    Color riskColor;
    switch (driver.riskCategory) {
      case 'Critical': riskColor = Colors.red[900]!; break;
      case 'High': riskColor = Colors.orange[800]!; break;
      case 'Medium': riskColor = Colors.amber[700]!; break;
      default: riskColor = Colors.green;
    }

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12), side: BorderSide(color: riskColor.withOpacity(0.5))),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            decoration: BoxDecoration(
              color: riskColor.withOpacity(0.1),
              borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
            ),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: riskColor,
                      child: Text(driver.driverName[0], style: const TextStyle(color: Colors.white)),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(driver.driverName, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: riskColor)),
                        Text(driver.driverId, style: TextStyle(color: Colors.grey[700], fontSize: 12)),
                      ],
                    ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('${driver.churnRiskScore} Risk', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: riskColor)),
                    Row(
                      children: [
                        Icon(Icons.trending_down, size: 16, color: Colors.red[700]),
                        Text('${driver.recentSentimentTrend}% Sentiment', style: TextStyle(color: Colors.red[700], fontSize: 12)),
                      ],
                    )
                  ],
                )
              ],
            ),
          ),
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('AI Detected Factors:', style: TextStyle(fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                ...driver.contributingFactors.map((factor) => Padding(
                  padding: const EdgeInsets.only(bottom: 4.0),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      const Text('• ', style: TextStyle(fontWeight: FontWeight.bold)),
                      Expanded(child: Text(factor, style: TextStyle(color: Colors.grey[800]))),
                    ],
                  ),
                )).toList(),
                const Divider(height: 24),
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.deepPurple[50], borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Icon(Icons.lightbulb, size: 16, color: Colors.deepPurple[800]),
                          const SizedBox(width: 4),
                          Text('Recommended Intervention', style: TextStyle(fontWeight: FontWeight.bold, color: Colors.deepPurple[900])),
                        ],
                      ),
                      const SizedBox(height: 4),
                      Text(driver.recommendedIntervention, style: TextStyle(color: Colors.deepPurple[800])),
                    ],
                  ),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton.icon(
                    onPressed: () {
                      ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Intervention workflow started for ${driver.driverName}')));
                    },
                    icon: Icon(Icons.phone, color: Colors.deepPurple[900]),
                    label: Text('INITIATE RETENTION ACTION', style: TextStyle(color: Colors.deepPurple[900], fontWeight: FontWeight.bold)),
                    style: OutlinedButton.styleFrom(side: BorderSide(color: Colors.deepPurple[900]!)),
                  ),
                )
              ],
            ),
          )
        ],
      ),
    );
  }
}
