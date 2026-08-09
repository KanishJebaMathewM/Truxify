import 'package:flutter/material.dart';
import '../models/platoon_match_model.dart';
import '../services/platoon_routing_service.dart';

class PlatoonMatchingScreen extends StatefulWidget {
  const PlatoonMatchingScreen({super.key});

  @override
  State<PlatoonMatchingScreen> createState() => _PlatoonMatchingScreenState();
}

class _PlatoonMatchingScreenState extends State<PlatoonMatchingScreen> {
  final PlatoonRoutingService _platoonService = PlatoonRoutingService();
  List<PlatoonMatch> _matches = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _loadMatches();
  }

  void _loadMatches() async {
    final matches = await _platoonService.findPlatoonMatches();
    if (mounted) {
      setState(() {
        _matches = matches;
        _isLoading = false;
      });
    }
  }

  void _linkWithDriver(PlatoonMatch match) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Expanded(child: Text('Synchronizing navigation with partner truck...')),
          ],
        ),
      )
    );

    final linkedMatch = await _platoonService.requestPlatoonLink(match);

    if (mounted) {
      Navigator.pop(context); // Close dialog
      setState(() {
        final index = _matches.indexWhere((m) => m.truckId == match.truckId);
        if (index != -1) {
          _matches[index] = linkedMatch;
        }
      });
      
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Platoon Linked! Rerouting to merge point with ${linkedMatch.driverName}.'),
          backgroundColor: Colors.blue[900],
        )
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Platoon Matching Engine'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildRadarHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _matches.length,
                    itemBuilder: (context, index) {
                      return _buildMatchCard(_matches[index]);
                    },
                  ),
                )
              ],
            ),
    );
  }

  Widget _buildRadarHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.blue[800],
      child: const Column(
        children: [
          Icon(Icons.radar, color: Colors.white, size: 48),
          SizedBox(height: 16),
          Text('Scanning for Truxify Partners...', style: TextStyle(color: Colors.white70)),
          SizedBox(height: 8),
          Text('Coordinate drafts to save up to 10% on fuel.', textAlign: TextAlign.center, style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildMatchCard(PlatoonMatch match) {
    final isLinked = match.status == 'Linked';

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    CircleAvatar(
                      backgroundColor: Colors.blue[100],
                      child: const Icon(Icons.person, color: Colors.blue),
                    ),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(match.driverName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                        Text('Truck: ${match.truckId}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(
                    color: isLinked ? Colors.blue[900] : Colors.green[100],
                    borderRadius: BorderRadius.circular(12),
                  ),
                  child: Text(
                    isLinked ? 'LINKED' : '${match.estimatedFuelSavingsPercent}% FUEL SAVINGS',
                    style: TextStyle(color: isLinked ? Colors.white : Colors.green[900], fontWeight: FontWeight.bold, fontSize: 10),
                  ),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildStat('Shared Route Segment', match.commonRouteSegment),
                _buildStat('Merge Point in', '${match.milesToMergePoint} mi'),
              ],
            ),
            const SizedBox(height: 16),
            if (isLinked)
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(color: Colors.blue[50], borderRadius: BorderRadius.circular(8)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.link, color: Colors.blue[900]),
                    const SizedBox(width: 8),
                    Text('PLATOON ACTIVE - MAINTAIN 50FT', style: TextStyle(color: Colors.blue[900], fontWeight: FontWeight.bold)),
                  ],
                ),
              )
            else
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _linkWithDriver(match),
                  icon: const Icon(Icons.compare_arrows),
                  label: const Text('REQUEST PLATOON LINK'),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[900], foregroundColor: Colors.white),
                ),
              )
          ],
        ),
      ),
    );
  }

  Widget _buildStat(String label, String value) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(value, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}
