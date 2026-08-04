import 'package:flutter/material.dart';
import 'dart:async';
import '../models/driver_fatigue_model.dart';
import '../services/sleep_cycle_predictor_service.dart';

class FatigueMonitoringDashboard extends StatefulWidget {
  const FatigueMonitoringDashboard({super.key});

  @override
  State<FatigueMonitoringDashboard> createState() => _FatigueMonitoringDashboardState();
}

class _FatigueMonitoringDashboardState extends State<FatigueMonitoringDashboard> {
  final SleepCyclePredictorService _fatigueService = SleepCyclePredictorService();
  StreamSubscription? _subscription;
  DriverFatigueProfile? _currentProfile;

  @override
  void initState() {
    super.initState();
    _subscription = _fatigueService.monitorFatigueLevels().listen((profile) {
      if (mounted) {
        setState(() {
          _currentProfile = profile;
        });
        if (!profile.isPhysicallySafeToDrive) {
          _showCriticalFatigueAlert();
        }
      }
    });
  }

  void _showCriticalFatigueAlert() {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        backgroundColor: Colors.red[900],
        title: const Row(
          children: [
            Icon(Icons.warning_amber_rounded, color: Colors.white, size: 32),
            SizedBox(width: 12),
            Text('CRITICAL FATIGUE', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
          ],
        ),
        content: const Text(
          'Biometric analysis indicates an extremely high risk of micro-sleep.\n\nEven though you have legal driving hours remaining, Truxify strongly recommends pulling over at the next safe exit to rest.',
          style: TextStyle(color: Colors.white, fontSize: 16),
        ),
        actions: [
          ElevatedButton(
            onPressed: () {
              Navigator.pop(context);
              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Routing to nearest rest stop...')));
            },
            style: ElevatedButton.styleFrom(backgroundColor: Colors.white, foregroundColor: Colors.red[900]),
            child: const Text('FIND NEAREST REST STOP'),
          )
        ],
      )
    );
  }

  @override
  void dispose() {
    _subscription?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Biometric Fatigue Predictor'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _currentProfile == null
          ? Center(child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                const CircularProgressIndicator(),
                const SizedBox(height: 16),
                Text('Syncing with Wearable Device...', style: TextStyle(color: Colors.indigo[900])),
              ],
            ))
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final bool isSafe = _currentProfile!.isPhysicallySafeToDrive;

    return SingleChildScrollView(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Container(
            padding: const EdgeInsets.all(20),
            decoration: BoxDecoration(
              color: isSafe ? Colors.green[100] : Colors.red[100],
              borderRadius: BorderRadius.circular(16),
              border: Border.all(color: isSafe ? Colors.green[400]! : Colors.red[400]!, width: 2)
            ),
            child: Row(
              children: [
                Icon(isSafe ? Icons.check_circle : Icons.dangerous, size: 48, color: isSafe ? Colors.green[800] : Colors.red[800]),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        isSafe ? 'DRIVER IS RESTED' : 'HIGH FATIGUE RISK',
                        style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: isSafe ? Colors.green[900] : Colors.red[900]),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        isSafe ? 'Biometrics indicate normal alertness levels.' : 'Biometrics indicate severe risk of micro-sleep.',
                        style: TextStyle(color: isSafe ? Colors.green[800] : Colors.red[800]),
                      )
                    ],
                  ),
                )
              ],
            ),
          ),
          const SizedBox(height: 32),
          const Text('Biometric Analysis', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey)),
          const SizedBox(height: 16),
          _buildStatCard('Fatigue Score', '${_currentProfile!.currentFatigueScore.toStringAsFixed(1)} / 100', Icons.battery_charging_full, isSafe ? Colors.blue : Colors.red),
          _buildStatCard('Sleep Quality', _currentProfile!.sleepQuality, Icons.bed, _currentProfile!.sleepQuality == 'POOR' ? Colors.orange : Colors.purple),
          _buildStatCard('Last 24h Sleep', '${(_currentProfile!.totalSleepMinutesLast24h / 60).toStringAsFixed(1)} hrs', Icons.access_time, Colors.teal),
          _buildStatCard('Avg Heart Rate', '${_currentProfile!.averageHeartRateBpm} BPM', Icons.favorite, Colors.redAccent),
          
          const SizedBox(height: 32),
          const Text('Compliance Status', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.grey)),
          const SizedBox(height: 16),
          Card(
            child: ListTile(
              leading: Icon(Icons.gavel, color: _currentProfile!.isLegallyAllowedToDrive ? Colors.green : Colors.red),
              title: const Text('Legal HoS Status', style: TextStyle(fontWeight: FontWeight.bold)),
              subtitle: Text(_currentProfile!.isLegallyAllowedToDrive ? 'Legal drive hours remaining' : 'HoS Violation'),
              trailing: !isSafe && _currentProfile!.isLegallyAllowedToDrive 
                  ? const Tooltip(
                      message: 'Legal but physically unsafe',
                      child: Icon(Icons.warning, color: Colors.orange),
                    )
                  : null,
            ),
          )
        ],
      ),
    );
  }

  Widget _buildStatCard(String title, String value, IconData icon, Color iconColor) {
    return Card(
      margin: const EdgeInsets.only(bottom: 12),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Row(
          children: [
            CircleAvatar(backgroundColor: iconColor.withOpacity(0.1), child: Icon(icon, color: iconColor)),
            const SizedBox(width: 16),
            Expanded(child: Text(title, style: const TextStyle(fontSize: 16))),
            Text(value, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
          ],
        ),
      ),
    );
  }
}
