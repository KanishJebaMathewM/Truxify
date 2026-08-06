import 'package:flutter/material.dart';
import '../models/parking_spot_model.dart';
import '../services/p2p_parking_service.dart';

class ParkingHandoffScreen extends StatefulWidget {
  const ParkingHandoffScreen({super.key});

  @override
  State<ParkingHandoffScreen> createState() => _ParkingHandoffScreenState();
}

class _ParkingHandoffScreenState extends State<ParkingHandoffScreen> {
  final P2PParkingService _parkingService = P2PParkingService();
  List<ParkingSpotHandoff> _availableSpots = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _scanForSpots();
  }

  void _scanForSpots() async {
    final spots = await _parkingService.findNearbyDepartures();
    if (mounted) {
      setState(() {
        _availableSpots = spots;
        _isLoading = false;
      });
    }
  }

  void _claimSpot(ParkingSpotHandoff spot) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const AlertDialog(
        content: Row(
          children: [
            CircularProgressIndicator(),
            SizedBox(width: 16),
            Expanded(child: Text('Connecting to departing driver via P2P network...')),
          ],
        ),
      )
    );

    final success = await _parkingService.reserveHandoff(spot);

    if (mounted && success) {
      Navigator.pop(context); // close loading
      setState(() {
        _availableSpots.removeWhere((s) => s.gpsCoordinates == spot.gpsCoordinates);
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Handoff confirmed! ${spot.departingDriver} is waiting for you.'),
          backgroundColor: Colors.green[800],
        )
      );
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('P2P Parking Handoff'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _availableSpots.length,
                    itemBuilder: (context, index) {
                      return _buildSpotCard(_availableSpots[index]);
                    },
                  ),
                )
              ],
            ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () {
          // Mock broadcasting own spot
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Broadcasting your departure to nearby Truxify drivers...'))
          );
        },
        backgroundColor: Colors.orange[800],
        icon: const Icon(Icons.podcasts),
        label: const Text('BROADCAST DEPARTURE'),
      ),
    );
  }

  Widget _buildHeader() {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: Colors.indigo[800],
      child: const Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.local_parking, color: Colors.white, size: 32),
              SizedBox(width: 12),
              Text('Live Driver Network', style: TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold)),
            ],
          ),
          SizedBox(height: 8),
          Text('Connect with drivers leaving rest stops in the next 15 minutes to guarantee your parking spot and avoid HOS violations.', style: TextStyle(color: Colors.white70)),
        ],
      ),
    );
  }

  Widget _buildSpotCard(ParkingSpotHandoff spot) {
    final minutesAway = spot.expectedDepartureTime.difference(DateTime.now()).inMinutes;

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(12)),
                  child: const Icon(Icons.directions_car, color: Colors.indigo, size: 32),
                ),
                const SizedBox(width: 16),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(spot.locationName, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                      const SizedBox(height: 4),
                      Text('Departing: ${spot.departingDriver}', style: const TextStyle(color: Colors.grey)),
                    ],
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: Colors.green[100], borderRadius: BorderRadius.circular(8)),
                  child: Column(
                    children: [
                      Text('~$minutesAway', style: TextStyle(color: Colors.green[900], fontSize: 18, fontWeight: FontWeight.bold)),
                      Text('MINS', style: TextStyle(color: Colors.green[900], fontSize: 10, fontWeight: FontWeight.bold)),
                    ],
                  ),
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                _buildTag(Icons.straight, spot.spotType),
                _buildTag(Icons.electrical_services, spot.hasHookups ? 'Shore Power' : 'No Hookups'),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton.icon(
                onPressed: () => _claimSpot(spot),
                icon: const Icon(Icons.handshake),
                label: const Text('RESERVE HANDOFF'),
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.indigo[900],
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 12),
                ),
              ),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTag(IconData icon, String label) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Colors.grey[600]),
        const SizedBox(width: 4),
        Text(label, style: TextStyle(color: Colors.grey[800], fontWeight: FontWeight.w500)),
      ],
    );
  }
}
