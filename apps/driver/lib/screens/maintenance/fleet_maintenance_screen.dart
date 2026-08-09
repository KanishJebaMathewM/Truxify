import 'dart:async';
import 'package:flutter/material.dart';
import 'package:truxify_driver/models/obd_telemetry_model.dart';
import 'package:truxify_driver/services/obd_maintenance_service.dart';

class FleetMaintenanceScreen extends StatefulWidget {
  const FleetMaintenanceScreen({Key? key}) : super(key: key);

  @override
  State<FleetMaintenanceScreen> createState() => _FleetMaintenanceScreenState();
}

class _FleetMaintenanceScreenState extends State<FleetMaintenanceScreen> {
  final ObdMaintenanceService _obdService = ObdMaintenanceService();
  ObdTelemetryModel? _currentTelemetry;
  String? _alertMessage;
  StreamSubscription<ObdTelemetryModel>? _telemetrySub;
  
  @override
  void initState() {
    super.initState();
    _startTelemetryStream();
  }

  @override
  void dispose() {
    _telemetrySub?.cancel();
    super.dispose();
  }

  void _startTelemetryStream() {
    _telemetrySub = _obdService.streamTelemetryData().listen((data) async {
      final prediction = await _obdService.predictFailure(data);
      if (mounted) {
        setState(() {
          _currentTelemetry = data;
          _alertMessage = prediction;
        });
      }
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Predictive Fleet Maintenance')),
      body: _currentTelemetry == null
          ? const Center(child: CircularProgressIndicator())
          : Padding(
              padding: const EdgeInsets.all(16.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  if (_alertMessage != null)
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: Colors.redAccent.withOpacity(0.2),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Row(
                        children: [
                          const Icon(Icons.warning, color: Colors.red),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Text(
                              _alertMessage!,
                              style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold),
                            ),
                          ),
                        ],
                      ),
                    ),
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(16.0),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Real-Time OBD-II Telemetry', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                          const Divider(),
                          ListTile(
                            leading: const Icon(Icons.thermostat),
                            title: const Text('Engine Temperature'),
                            trailing: Text('${_currentTelemetry!.engineTemperature.toStringAsFixed(1)}°C', style: const TextStyle(fontSize: 16)),
                          ),
                          ListTile(
                            leading: const Icon(Icons.tire_repair),
                            title: const Text('Tire Pressure'),
                            trailing: Text('${_currentTelemetry!.tirePressure.toStringAsFixed(1)} PSI', style: const TextStyle(fontSize: 16)),
                          ),
                          ListTile(
                            leading: const Icon(Icons.water_drop),
                            title: const Text('Fluid Levels'),
                            trailing: Text('${_currentTelemetry!.fluidLevels.toStringAsFixed(1)}%', style: const TextStyle(fontSize: 16)),
                          ),
                        ],
                      ),
                    ),
                  ),
                  const Spacer(),
                  Center(
                    child: Text(
                      'Last Updated: ${_currentTelemetry!.timestamp.toLocal()}',
                      style: const TextStyle(fontSize: 12, color: Colors.grey),
                    ),
                  ),
                ],
              ),
            ),
    );
  }
}
