import 'package:flutter/material.dart';
import '../models/driver_safety_score_model.dart';
import '../services/safety_gamification_service.dart';

class SafetyLeaderboardScreen extends StatefulWidget {
  const SafetyLeaderboardScreen({super.key});

  @override
  State<SafetyLeaderboardScreen> createState() => _SafetyLeaderboardScreenState();
}

class _SafetyLeaderboardScreenState extends State<SafetyLeaderboardScreen> {
  final SafetyGamificationService _gamificationService = SafetyGamificationService();
  List<DriverSafetyScore> _leaderboard = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadData();
  }

  void _loadData() async {
    final data = await _gamificationService.getMonthlyLeaderboard();
    if (mounted) {
      setState(() {
        _leaderboard = data;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Safety Excellence Rewards'),
        backgroundColor: Colors.amber[800],
      ),
      backgroundColor: Colors.grey[100],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildRewardsHeader(),
                Expanded(
                  child: ListView.builder(
                    itemCount: _leaderboard.length,
                    itemBuilder: (context, index) {
                      return _buildLeaderboardTile(_leaderboard[index]);
                    },
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildRewardsHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: Colors.amber[700],
        borderRadius: const BorderRadius.only(bottomLeft: Radius.circular(32), bottomRight: Radius.circular(32)),
        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 10, offset: Offset(0, 5))],
      ),
      child: Column(
        children: [
          const Icon(Icons.emoji_events, size: 64, color: Colors.white),
          const SizedBox(height: 16),
          const Text('August Leaderboard', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          const Text('Top 3 drivers earn \$500 monthly bonus!', style: TextStyle(color: Colors.white70, fontSize: 16)),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildPodium(_leaderboard.length > 1 ? _leaderboard[1] : null, 2, 80),
              _buildPodium(_leaderboard.isNotEmpty ? _leaderboard[0] : null, 1, 120),
              _buildPodium(_leaderboard.length > 2 ? _leaderboard[2] : null, 3, 60),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildPodium(DriverSafetyScore? driver, int rank, double height) {
    if (driver == null) return const SizedBox();
    
    Color rankColor = rank == 1 ? Colors.yellow[300]! : rank == 2 ? Colors.grey[300]! : Colors.orange[300]!;

    return Column(
      mainAxisAlignment: MainAxisAlignment.end,
      children: [
        CircleAvatar(
          radius: 24,
          backgroundColor: rankColor,
          child: Text(driver.avatarUrl, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.black)),
        ),
        const SizedBox(height: 8),
        Text('${driver.totalScore} pts', style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Container(
          width: 60,
          height: height,
          decoration: BoxDecoration(
            color: Colors.amber[900],
            borderRadius: const BorderRadius.only(topLeft: Radius.circular(12), topRight: Radius.circular(12)),
          ),
          child: Center(child: Text('#$rank', style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold))),
        )
      ],
    );
  }

  Widget _buildLeaderboardTile(DriverSafetyScore driver) {
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
      decoration: BoxDecoration(
        color: driver.isCurrentUser ? Colors.amber[50] : Colors.white,
        borderRadius: BorderRadius.circular(16),
        border: driver.isCurrentUser ? Border.all(color: Colors.amber, width: 2) : null,
        boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
      ),
      child: ExpansionTile(
        leading: CircleAvatar(
          backgroundColor: Colors.grey[200],
          child: Text('#${driver.rank}', style: const TextStyle(color: Colors.black87, fontWeight: FontWeight.bold)),
        ),
        title: Row(
          children: [
            Text(driver.driverName, style: const TextStyle(fontWeight: FontWeight.bold)),
            if (driver.isCurrentUser)
              Container(
                margin: const EdgeInsets.only(left: 8),
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                decoration: BoxDecoration(color: Colors.amber, borderRadius: BorderRadius.circular(12)),
                child: const Text('YOU', style: TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
              )
          ],
        ),
        trailing: Text('${driver.totalScore}', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.amber[800])),
        children: [
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildStatColumn('Braking', '${driver.harshBrakingEvents}', driver.harshBrakingEvents > 5 ? Colors.red : Colors.green),
                _buildStatColumn('Speeding', '${driver.speedingEvents}', driver.speedingEvents > 3 ? Colors.red : Colors.green),
                _buildStatColumn('Cornering', '${driver.corneringEvents}', driver.corneringEvents > 5 ? Colors.red : Colors.green),
              ],
            ),
          )
        ],
      ),
    );
  }

  Widget _buildStatColumn(String label, String value, Color color) {
    return Column(
      children: [
        Text(value, style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: color)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
