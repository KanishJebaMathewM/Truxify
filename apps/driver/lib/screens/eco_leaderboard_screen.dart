import 'package:flutter/material.dart';
import '../models/eco_leaderboard_model.dart';
import '../services/eco_leaderboard_service.dart';

class EcoLeaderboardScreen extends StatefulWidget {
  const EcoLeaderboardScreen({super.key});

  @override
  State<EcoLeaderboardScreen> createState() => _EcoLeaderboardScreenState();
}

class _EcoLeaderboardScreenState extends State<EcoLeaderboardScreen> {
  final EcoLeaderboardService _service = EcoLeaderboardService();
  EcoLeaderboardSession? _session;

  @override
  void initState() {
    super.initState();
    _service.leaderboardStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.fetchLeaderboard();
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
        title: const Text('Eco-Driving Leaderboard'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[100],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildHeroSection(s),
        Expanded(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              const Text('COMPANY RANKINGS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.leaderboard.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.leaderboard.map((driver) => _buildDriverCard(driver, isCurrentUser: driver.driverName.contains('You'))),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildHeroSection(EcoLeaderboardSession s) {
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
          const Text('YOUR ECO SCORE', style: TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 2.0)),
          Text(s.currentDriverScore > 0 ? '${s.currentDriverScore}' : '--', style: const TextStyle(color: Colors.white, fontSize: 64, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(Icons.local_gas_station, color: Colors.white70, size: 16),
              const SizedBox(width: 8),
              Text('${s.fuelSavedGallons} Gal Saved This Week', style: const TextStyle(color: Colors.white70, fontSize: 14, fontWeight: FontWeight.bold)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildDriverCard(DriverEcoScore driver, {required bool isCurrentUser}) {
    Color rankColor;
    if (driver.rank == 1) rankColor = Colors.amber;
    else if (driver.rank == 2) rankColor = Colors.blueGrey[300]!;
    else if (driver.rank == 3) rankColor = Colors.brown[300]!;
    else rankColor = Colors.grey[400]!;

    IconData trendIcon;
    Color trendColor;
    if (driver.trend == 'Up') {
      trendIcon = Icons.arrow_upward;
      trendColor = Colors.green;
    } else if (driver.trend == 'Down') {
      trendIcon = Icons.arrow_downward;
      trendColor = Colors.red;
    } else {
      trendIcon = Icons.remove;
      trendColor = Colors.grey;
    }

    return Card(
      elevation: isCurrentUser ? 8 : 1,
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(16),
        side: BorderSide(color: isCurrentUser ? Colors.teal : Colors.transparent, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Container(
              width: 40,
              height: 40,
              decoration: BoxDecoration(
                color: rankColor.withOpacity(0.2),
                shape: BoxShape.circle,
                border: Border.all(color: rankColor, width: 2),
              ),
              child: Center(child: Text('${driver.rank}', style: TextStyle(color: rankColor, fontWeight: FontWeight.bold, fontSize: 18))),
            ),
            const SizedBox(width: 16),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(driver.driverName, style: TextStyle(fontWeight: FontWeight.bold, fontSize: 18, color: isCurrentUser ? Colors.teal[800] : Colors.black87)),
                  const SizedBox(height: 4),
                  if (driver.badges.isNotEmpty)
                    Wrap(
                      spacing: 4,
                      children: driver.badges.map((b) => Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12), border: Border.all(color: Colors.green[200]!)),
                        child: Text(b, style: TextStyle(fontSize: 10, color: Colors.green[800], fontWeight: FontWeight.bold)),
                      )).toList(),
                    ),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text('${driver.score}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 24)),
                Row(
                  children: [
                    Icon(trendIcon, size: 12, color: trendColor),
                    Text(driver.trend, style: TextStyle(fontSize: 12, color: trendColor, fontWeight: FontWeight.bold)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }
}
