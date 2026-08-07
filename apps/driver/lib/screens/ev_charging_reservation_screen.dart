import 'package:flutter/material.dart';
import '../models/ev_charging_station_model.dart';
import '../services/ev_charging_network_service.dart';
import 'package:intl/intl.dart';

class EvChargingReservationScreen extends StatefulWidget {
  const EvChargingReservationScreen({super.key});

  @override
  State<EvChargingReservationScreen> createState() => _EvChargingReservationScreenState();
}

class _EvChargingReservationScreenState extends State<EvChargingReservationScreen> {
  final EvChargingNetworkService _networkService = EvChargingNetworkService();
  List<EvChargingStation> _stations = [];
  bool _isLoading = true;
  EvReservation? _activeReservation;

  @override
  void initState() {
    super.initState();
    _loadStations();
  }

  void _loadStations() async {
    final stations = await _networkService.getStationsOnRoute();
    if (mounted) {
      setState(() {
        _stations = stations.where((s) => s.isClass8Compatible).toList(); // Filter out consumer stations
        _isLoading = false;
      });
    }
  }

  void _makeReservation(EvChargingStation station) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => const Center(child: CircularProgressIndicator()),
    );

    // Calculate ETA based on distance assuming 60mph average
    final etaHours = station.distanceMiles / 60.0;
    final eta = DateTime.now().add(Duration(minutes: (etaHours * 60).toInt()));

    final reservation = await _networkService.reserveBay(station, eta);

    if (mounted) {
      Navigator.pop(context); // Dismiss loading dialog
      setState(() {
        _activeReservation = reservation;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('EV Semi Charging Network'),
        backgroundColor: Colors.green[800],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildSocHeader(),
                if (_activeReservation != null) _buildActiveReservation(),
                Expanded(
                  child: ListView.builder(
                    padding: const EdgeInsets.all(16),
                    itemCount: _stations.length,
                    itemBuilder: (context, index) {
                      return _buildStationCard(_stations[index]);
                    },
                  ),
                ),
              ],
            ),
    );
  }

  Widget _buildSocHeader() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(24),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text('Current State of Charge', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              Row(
                children: [
                  Icon(Icons.battery_3_bar, color: Colors.orange[800], size: 32),
                  const SizedBox(width: 8),
                  Text('32%', style: TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.orange[800])),
                ],
              )
            ],
          ),
          Column(
            crossAxisAlignment: CrossAxisAlignment.end,
            children: [
              const Text('Est. Range Remaining', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              const SizedBox(height: 8),
              const Text('105 miles', style: TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
            ],
          )
        ],
      ),
    );
  }

  Widget _buildActiveReservation() {
    final res = _activeReservation!;
    return Container(
      width: double.infinity,
      color: Colors.green[50],
      padding: const EdgeInsets.all(16),
      margin: const EdgeInsets.only(bottom: 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(Icons.check_circle, color: Colors.green[800]),
              const SizedBox(width: 8),
              Text('Megawatt Bay Reserved', style: TextStyle(color: Colors.green[900], fontWeight: FontWeight.bold, fontSize: 18)),
            ],
          ),
          const SizedBox(height: 8),
          Text(res.station.stationName, style: const TextStyle(fontWeight: FontWeight.bold)),
          Text('ETA: ${DateFormat('h:mm a').format(res.reservedTime)}', style: TextStyle(color: Colors.green[800])),
          const SizedBox(height: 4),
          Text('Reservation ID: ${res.reservationId}', style: const TextStyle(color: Colors.grey, fontSize: 12)),
        ],
      ),
    );
  }

  Widget _buildStationCard(EvChargingStation station) {
    final bool isAvailable = station.availableBays > 0;
    
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
                Expanded(child: Text(station.stationName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
                Text('${station.distanceMiles} mi', style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    Icon(Icons.ev_station, color: isAvailable ? Colors.green : Colors.red, size: 20),
                    const SizedBox(width: 4),
                    Text('${station.availableBays}/${station.totalMegawattBays} Bays Available', 
                      style: TextStyle(color: isAvailable ? Colors.green[800] : Colors.red[800], fontWeight: FontWeight.bold)),
                  ],
                ),
                Text('\$${station.kwPrice}/kWh', style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 16),
            if (!isAvailable)
               Row(
                children: [
                  const Icon(Icons.access_time, size: 16, color: Colors.orange),
                  const SizedBox(width: 4),
                  Text('Est. Wait: ${station.estimatedWaitTime}', style: const TextStyle(color: Colors.orange, fontWeight: FontWeight.bold)),
                ],
              ),
            if (isAvailable && _activeReservation == null)
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () => _makeReservation(station),
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.green[800], foregroundColor: Colors.white),
                  child: const Text('RESERVE BAY FOR ETA'),
                ),
              )
          ],
        ),
      ),
    );
  }
}
