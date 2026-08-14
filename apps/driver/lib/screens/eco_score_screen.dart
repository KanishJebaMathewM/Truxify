import 'package:flutter/material.dart';
import '../models/eco_score_model.dart';
import '../services/eco_score_service.dart';

class EcoScoreScreen extends StatefulWidget {
  const EcoScoreScreen({super.key});

  @override
  State<EcoScoreScreen> createState() => _EcoScoreScreenState();
}

class _EcoScoreScreenState extends State<EcoScoreScreen> {
  final EcoScoreService _service = EcoScoreService();
  EcoScoreSession? _session;

  @override
  void initState() {
    super.initState();
    _service.scoreStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.simulateEcoTracking();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Fleet Eco-Score'),
        backgroundColor: Colors.green[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;
    
    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              _buildBonusCard(s),
              const SizedBox(height: 24),
              const Text('COMPANY LEADERBOARD', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildLeaderboard(s.topDrivers),
              const SizedBox(height: 24),
              const Text('TELEMETRY BREAKDOWN', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              ...s.metrics.map((m) => _buildMetricCard(m)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(EcoScoreSession s) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [Colors.green[800]!, Colors.teal[700]!],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
      ),
      child: Column(
        children: [
          const Icon(Icons.eco, color: Colors.white, size: 48),
          const SizedBox(height: 16),
          const Text('YOUR ECO-SCORE', style: TextStyle(color: Colors.white70, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 2)),
          const SizedBox(height: 8),
          Text('${s.currentEcoScore}', style: const TextStyle(color: Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildBonusCard(EcoScoreSession s) {
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          children: [
            Row(
              children: [
                Icon(Icons.monetization_on, color: Colors.green[700], size: 32),
                const SizedBox(width: 12),
                const Text('FUEL SAVINGS BONUS', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('${s.estimatedFuelSavedGal} gal', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                    const Text('Fuel Saved', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('+\$${s.financialBonusAccrued.toStringAsFixed(2)}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 32, color: Colors.green[800])),
                    const Text('Unpaid Accrual', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                ),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildLeaderboard(List<LeaderboardRank> drivers) {
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Column(
        children: drivers.map((d) {
          bool isMe = d.isCurrentUser;
          return Container(
            color: isMe ? Colors.yellow[100] : Colors.transparent,
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: d.rank == 1 ? Colors.amber : (d.rank == 2 ? Colors.grey[400] : Colors.brown[300]),
                child: Text('#${d.rank}', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
              ),
              title: Text(d.driverName, style: TextStyle(fontWeight: isMe ? FontWeight.bold : FontWeight.normal, color: isMe ? Colors.black87 : Colors.grey[800])),
              trailing: Text('${d.totalScore}', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: isMe ? Colors.green[800] : Colors.black87)),
            ),
          );
        }).toList(),
      ),
    );
  }

  Widget _buildMetricCard(EcoMetric m) {
    Color statColor = m.score >= 90 ? Colors.green : (m.score >= 75 ? Colors.orange : Colors.red);
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      elevation: 1,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceBetween,
          children: [
            Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(m.metricName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
                const SizedBox(height: 4),
                Text(m.status, style: TextStyle(color: statColor, fontSize: 12, fontWeight: FontWeight.bold)),
              ],
            ),
            Stack(
              alignment: Alignment.center,
              children: [
                SizedBox(
                  width: 50,
                  height: 50,
                  child: CircularProgressIndicator(
                    value: m.score / 100,
                    backgroundColor: Colors.grey[200],
                    color: statColor,
                    strokeWidth: 4,
                  ),
                ),
                Text('${m.score.toInt()}', style: TextStyle(fontWeight: FontWeight.bold, color: statColor)),
              ],
            )
          ],
        ),
      ),
    );
  }
}
