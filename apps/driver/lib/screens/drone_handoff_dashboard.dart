import 'package:flutter/material.dart';
import '../models/drone_delivery_model.dart';
import '../services/drone_telemetry_service.dart';

class DroneHandoffDashboard extends StatefulWidget {
  const DroneHandoffDashboard({super.key});

  @override
  State<DroneHandoffDashboard> createState() => _DroneHandoffDashboardState();
}

class _DroneHandoffDashboardState extends State<DroneHandoffDashboard> {
  final DroneTelemetryService _droneService = DroneTelemetryService();
  MobileHubState? _hubState;
  List<DroneMission> _missions = [];
  bool _isLoading = true;

  @override
  void initState() {
    super.initState();
    _initData();
  }

  void _initData() async {
    final state = await _droneService.getHubState();
    if (mounted) {
      setState(() {
        _hubState = state;
        _isLoading = false;
      });
      
      _droneService.streamDroneMissions().listen((missions) {
        if (mounted) {
          setState(() {
            _missions = missions;
          });
        }
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Last-Mile Drone Hub'),
        backgroundColor: Colors.blueAccent[700],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHubStatusCard(),
                Expanded(child: _buildMissionsList()),
                _buildLaunchControl(),
              ],
            ),
    );
  }

  Widget _buildHubStatusCard() {
    final h = _hubState!;
    return Container(
      width: double.infinity,
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(h.isSafeLaunchZone ? Icons.check_circle : Icons.cancel, color: h.isSafeLaunchZone ? Colors.green : Colors.red),
              const SizedBox(width: 8),
              Text(h.hubLocation, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            ],
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceAround,
            children: [
              _buildHubStat('Drones Active', '${h.dronesInFlight} / ${h.totalDronesAvailable}', Colors.blueAccent[700]!),
              _buildHubStat('Parcels Left', '${h.parcelsRemaining}', Colors.deepOrange),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildHubStat(String label, String val, Color color) {
    return Column(
      children: [
        Text(label, style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text(val, style: TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: color)),
      ],
    );
  }

  Widget _buildMissionsList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _missions.length,
      itemBuilder: (context, index) {
        final m = _missions[index];
        return Card(
          margin: const EdgeInsets.only(bottom: 12),
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
                        Icon(Icons.airplanemode_active, color: Colors.blueAccent[700]),
                        const SizedBox(width: 8),
                        Text(m.droneId, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                      ],
                    ),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(
                        color: m.status == 'Delivering' ? Colors.green[100] : Colors.blue[50],
                        borderRadius: BorderRadius.circular(12)
                      ),
                      child: Text(m.status.toUpperCase(), style: TextStyle(color: m.status == 'Delivering' ? Colors.green[800] : Colors.blueAccent[700], fontWeight: FontWeight.bold, fontSize: 12)),
                    )
                  ],
                ),
                const Divider(height: 24),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text('Target', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        Text(m.destinationAddress, style: const TextStyle(fontWeight: FontWeight.bold)),
                      ],
                    ),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.end,
                      children: [
                        const Text('ETA', style: TextStyle(color: Colors.grey, fontSize: 12)),
                        Text('${m.estimatedTimeOfArrivalMins} min', style: const TextStyle(fontWeight: FontWeight.bold)),
                      ],
                    )
                  ],
                ),
                const SizedBox(height: 12),
                LinearProgressIndicator(
                  value: m.batteryPercentage / 100,
                  backgroundColor: Colors.grey[300],
                  color: m.batteryPercentage > 20 ? Colors.green : Colors.red,
                ),
                const SizedBox(height: 4),
                Text('Battery: ${m.batteryPercentage}%', style: const TextStyle(color: Colors.grey, fontSize: 10)),
              ],
            ),
          ),
        );
      },
    );
  }

  Widget _buildLaunchControl() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.only(topLeft: Radius.circular(24), topRight: Radius.circular(24)),
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 10, offset: Offset(0, -5))]
      ),
      child: SizedBox(
        width: double.infinity,
        height: 56,
        child: ElevatedButton.icon(
          onPressed: _hubState?.isSafeLaunchZone == true ? () {
             ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Initializing launch sequence for next parcel...')));
          } : null,
          icon: const Icon(Icons.rocket_launch),
          label: const Text('AUTHORIZE NEXT DRONE LAUNCH', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent[700], foregroundColor: Colors.white),
        ),
      ),
    );
  }
}
