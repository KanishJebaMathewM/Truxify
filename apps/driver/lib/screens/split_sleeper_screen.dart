import 'package:flutter/material.dart';
import '../models/split_sleeper_model.dart';
import '../services/split_sleeper_service.dart';

class SplitSleeperScreen extends StatefulWidget {
  const SplitSleeperScreen({super.key});

  @override
  State<SplitSleeperScreen> createState() => _SplitSleeperScreenState();
}

class _SplitSleeperScreenState extends State<SplitSleeperScreen> {
  final SplitSleeperService _service = SplitSleeperService();
  SplitSleeperSession? _session;

  @override
  void initState() {
    super.initState();
    _service.sleeperStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.analyzeLogbook();
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
        title: const Text('HOS Split-Sleeper AI'),
        backgroundColor: Colors.blueGrey[900],
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
              _buildClockCard(s),
              const SizedBox(height: 24),
              const Text('AI RECOMMENDATION', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              _buildRecommendationCard(s),
              const SizedBox(height: 24),
              const Text('CURRENT SHIFT TIMELINE', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              const SizedBox(height: 12),
              if (s.currentShiftLog.isEmpty)
                const Center(child: CircularProgressIndicator())
              else
                ...s.currentShiftLog.map((event) => _buildTimelineEventCard(event)),
            ],
          ),
        )
      ],
    );
  }

  Widget _buildStatusHeader(SplitSleeperSession s) {
    bool isOptimized = s.algorithmStatus.contains('Optimized');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isOptimized ? Colors.teal[800] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isOptimized ? Icons.check_circle : Icons.calculate, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('HOS RULES ENGINE', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.algorithmStatus.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildClockCard(SplitSleeperSession s) {
    bool isCritical = s.driveTimeRemaining < 2.0 && s.driveTimeRemaining > 0;

    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(24),
        child: Row(
          mainAxisAlignment: MainAxisAlignment.spaceAround,
          children: [
            Column(
              children: [
                Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      width: 100,
                      height: 100,
                      child: CircularProgressIndicator(
                        value: s.driveTimeRemaining / 11.0,
                        backgroundColor: Colors.grey[200],
                        color: isCritical ? Colors.red : Colors.green,
                        strokeWidth: 10,
                      ),
                    ),
                    Text('${s.driveTimeRemaining}h', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: isCritical ? Colors.red : Colors.green)),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('Drive Time', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
              ],
            ),
            Column(
              children: [
                Stack(
                  alignment: Alignment.center,
                  children: [
                    SizedBox(
                      width: 100,
                      height: 100,
                      child: CircularProgressIndicator(
                        value: s.shiftTimeRemaining / 14.0,
                        backgroundColor: Colors.grey[200],
                        color: Colors.blue,
                        strokeWidth: 10,
                      ),
                    ),
                    Text('${s.shiftTimeRemaining}h', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.blue)),
                  ],
                ),
                const SizedBox(height: 12),
                const Text('14-Hour Shift', style: TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildRecommendationCard(SplitSleeperSession s) {
    if (s.recommendedSplitType.contains('Calculating')) {
       return const Card(
          child: Padding(
            padding: EdgeInsets.all(24),
            child: Center(child: Text('Calculating optimal break strategy...')),
          ),
        );
    }

    return Card(
      elevation: 8,
      color: Colors.teal[50],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.teal[300]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.psychology, color: Colors.teal),
                const SizedBox(width: 12),
                Text(s.recommendedSplitType, style: TextStyle(color: Colors.teal[900], fontWeight: FontWeight.bold, fontSize: 18)),
              ],
            ),
            const Divider(height: 24),
            Text(s.optimalAction, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, height: 1.4)),
            const SizedBox(height: 16),
            ElevatedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.bed),
              label: const Text('Start 2.0hr Off-Duty Break Now'),
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.teal,
                foregroundColor: Colors.white,
                minimumSize: const Size(double.infinity, 48),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTimelineEventCard(HosTimelineEvent e) {
    Color statusColor;
    IconData statusIcon;

    if (e.status.contains('Driving')) {
      statusColor = Colors.green;
      statusIcon = Icons.local_shipping;
    } else if (e.status.contains('On Duty')) {
      statusColor = Colors.orange;
      statusIcon = Icons.work;
    } else {
      statusColor = Colors.grey;
      statusIcon = Icons.bed;
    }

    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
      child: ListTile(
        leading: Icon(statusIcon, color: statusColor),
        title: Text(e.status, style: const TextStyle(fontWeight: FontWeight.bold)),
        trailing: Text('${e.durationHours} hrs', style: TextStyle(color: statusColor, fontWeight: FontWeight.bold, fontSize: 16)),
      ),
    );
  }
}
