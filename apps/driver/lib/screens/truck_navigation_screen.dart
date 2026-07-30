import 'package:flutter/material.dart';
import '../models/truck_profile_model.dart';
import '../services/commercial_navigation_service.dart';

class TruckNavigationScreen extends StatefulWidget {
  const TruckNavigationScreen({super.key});

  @override
  State<TruckNavigationScreen> createState() => _TruckNavigationScreenState();
}

class _TruckNavigationScreenState extends State<TruckNavigationScreen> {
  final CommercialNavigationService _navService = CommercialNavigationService();
  final TextEditingController _destController = TextEditingController(text: 'Chicago Distribution Center');
  
  NavigationRoute? _currentRoute;
  bool _isCalculating = false;

  final TruckProfile _myTruck = TruckProfile(
    heightFeet: 13.5, // Standard dry van height
    widthFeet: 8.5,
    grossWeightLbs: 79500, // Near max legal weight
    axles: 5,
    hazmatClass: 'NONE',
    has53FootTrailer: true,
  );

  Future<void> _calculateRoute() async {
    setState(() {
      _isCalculating = true;
      _currentRoute = null;
    });

    final route = await _navService.calculateSafeRoute('Current Location', _destController.text, _myTruck);

    if (mounted) {
      setState(() {
        _currentRoute = route;
        _isCalculating = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Commercial Truck Navigation'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildSearchHeader(),
          Expanded(
            child: _isCalculating
                ? const Center(
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        CircularProgressIndicator(),
                        SizedBox(height: 16),
                        Text('Calculating truck-safe route...', style: TextStyle(color: Colors.grey, fontSize: 16)),
                      ],
                    ),
                  )
                : _currentRoute == null
                    ? const Center(child: Text('Enter a destination to route.'))
                    : _buildRouteDetails(),
          )
        ],
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Container(
      padding: const EdgeInsets.all(16.0),
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              const Icon(Icons.my_location, color: Colors.blue),
              const SizedBox(width: 12),
              const Expanded(child: Text('Current Location', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
            ],
          ),
          const Padding(
            padding: EdgeInsets.only(left: 10.0),
            child: SizedBox(height: 16, child: VerticalDivider(color: Colors.grey, thickness: 2)),
          ),
          Row(
            children: [
              const Icon(Icons.location_on, color: Colors.red),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: _destController,
                  decoration: const InputDecoration(
                    border: InputBorder.none,
                    hintText: 'Enter destination facility...',
                  ),
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                ),
              ),
            ],
          ),
          const SizedBox(height: 16),
          ElevatedButton.icon(
            onPressed: _calculateRoute,
            icon: const Icon(Icons.directions),
            label: const Text('CALCULATE SAFE ROUTE'),
            style: ElevatedButton.styleFrom(backgroundColor: Colors.blueGrey[900], foregroundColor: Colors.white),
          )
        ],
      ),
    );
  }

  Widget _buildRouteDetails() {
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Mock Map Area
          Container(
            height: 200,
            width: double.infinity,
            decoration: BoxDecoration(
              color: Colors.blue[50],
              borderRadius: BorderRadius.circular(12),
              border: Border.all(color: Colors.blue[200]!),
            ),
            child: const Center(
              child: Icon(Icons.map, size: 64, color: Colors.blue),
            ),
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('${_currentRoute!.estimatedTimeMinutes.toStringAsFixed(0)} min', style: const TextStyle(fontSize: 32, fontWeight: FontWeight.bold, color: Colors.green)),
              Text('${_currentRoute!.distanceMiles.toStringAsFixed(1)} mi', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold, color: Colors.grey)),
            ],
          ),
          const SizedBox(height: 32),
          const Text('Routing around hazards based on your profile:', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(color: Colors.blueGrey[50], borderRadius: BorderRadius.circular(8)),
            child: Row(
              children: [
                const Icon(Icons.straighten, color: Colors.blueGrey),
                const SizedBox(width: 12),
                Text('${_myTruck.heightFeet}ft Height | ${_myTruck.grossWeightLbs}lbs | Hazmat: ${_myTruck.hazmatClass}'),
              ],
            ),
          ),
          const SizedBox(height: 16),
          if (_currentRoute!.avoidedHazards.isEmpty)
            const Text('No specific hazards detected on the standard route.', style: TextStyle(color: Colors.grey))
          else
            ..._currentRoute!.avoidedHazards.map((hazard) => Padding(
              padding: const EdgeInsets.only(bottom: 8.0),
              child: Row(
                children: [
                  const Icon(Icons.block, color: Colors.red, size: 20),
                  const SizedBox(width: 8),
                  Expanded(child: Text('Avoided: $hazard', style: const TextStyle(color: Colors.red))),
                ],
              ),
            )),
            
          const SizedBox(height: 32),
          SizedBox(
            width: double.infinity,
            height: 56,
            child: ElevatedButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.navigation),
              label: const Text('START NAVIGATION', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }
}
