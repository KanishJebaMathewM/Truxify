import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

class LoadPostingScreen extends StatefulWidget {
  const LoadPostingScreen({Key? key}) : super(key: key);

  @override
  State<LoadPostingScreen> createState() => _LoadPostingScreenState();
}

class _LoadPostingScreenState extends State<LoadPostingScreen> {
  final _formKey = GlobalKey<FormState>();
  final TextEditingController _originController = TextEditingController();
  final TextEditingController _destController = TextEditingController();
  
  // Mock route coordinates for live map synchronization
  List<LatLng> _routePoints = [
    LatLng(13.0827, 80.2707), // Default Origin (Chennai)
    LatLng(12.9716, 77.5946), // Default Destination (Bangalore)
  ];

  void _updateRoute(String origin, String destination) {
    // In production, geocode or fetch polyline from navigation service
    setState(() {
      if (origin.toLowerCase().contains('mumbai')) {
        _routePoints = [LatLng(19.0760, 72.8777), LatLng(13.0827, 80.2707)];
      } else {
        _routePoints = [LatLng(13.0827, 80.2707), LatLng(12.9716, 77.5946)];
      }
    });
  }

  @override
  void dispose() {
    _originController.dispose();
    _destController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final bool isDesktop = MediaQuery.of(context).size.width >= 1024;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Post a Load & Book Transport'),
        elevation: 1,
      ),
      body: isDesktop ? _buildSplitScreenLayout() : _buildMobileWizardLayout(),
    );
  }

  // Desktop 40/60 Split-Pane Layout
  Widget _buildSplitScreenLayout() {
    return Row(
      children: [
        // Left 40% Panel: Booking Form & ML Price Estimation
        Expanded(
          flex: 4,
          child: Container(
            color: Theme.of(context).cardColor,
            padding: const EdgeInsets.all(24.0),
            child: Form(
              key: _formKey,
              child: ListView(
                children: [
                  const Text(
                    'Load & Route Details',
                    style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 20),
                  TextFormField(
                    controller: _originController,
                    decoration: const InputDecoration(
                      labelText: 'Pickup Location (Origin)',
                      prefixIcon: Icon(Icons.trip_origin),
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (val) => _updateRoute(val, _destController.text),
                  ),
                  const SizedBox(height: 16),
                  TextFormField(
                    controller: _destController,
                    decoration: const InputDecoration(
                      labelText: 'Delivery Location (Destination)',
                      prefixIcon: Icon(Icons.location_on),
                      border: OutlineInputBorder(),
                    ),
                    onChanged: (val) => _updateRoute(_originController.text, val),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<String>(
                    decoration: const InputDecoration(
                      labelText: 'Vehicle Type Required',
                      border: OutlineInputBorder(),
                    ),
                    items: const [
                      DropdownMenuItem(value: 'mini_truck', child: Text('Mini Truck (1-2 Ton)')),
                      DropdownMenuItem(value: 'container_20ft', child: Text('20ft Container')),
                      DropdownMenuItem(value: 'heavy_multi_axle', child: Text('Heavy Multi-Axle')),
                    ],
                    onChanged: (val) {},
                  ),
                  const SizedBox(height: 24),
                  // ML Price Prediction Card
                  Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: Colors.blue.withOpacity(0.08),
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: Colors.blue.shade200),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: const [
                        Text('Estimated Freight Cost (ML Model)', style: TextStyle(fontWeight: FontWeight.bold)),
                        SizedBox(height: 8),
                        Text('\$450.00 - \$520.00', style: TextStyle(fontSize: 22, color: Colors.blue, fontWeight: FontWeight.bold)),
                        Text('Based on distance, live traffic, and historical spot rates.', style: TextStyle(fontSize: 12, color: Colors.grey)),
                      ],
                    ),
                  ),
                  const SizedBox(height: 32),
                  ElevatedButton.icon(
                    style: ElevatedButton.styleFrom(padding: const EdgeInsets.symmetric(vertical: 16)),
                    onPressed: () {
                      if (_formKey.currentState?.validate() ?? false) {
                        ScaffoldMessenger.of(context).showSnackBar(
                          const SnackBar(content: Text('Load posted successfully! Matching nearby trucks...')),
                        );
                      }
                    },
                    icon: const Icon(Icons.local_shipping),
                    label: const Text('Find Available Trucks', style: TextStyle(fontSize: 16)),
                  ),
                ],
              ),
            ),
          ),
        ),
        const VerticalDivider(width: 1, thickness: 1),
        // Right 60% Panel: Interactive OpenStreetMap & Route Visualizer
        Expanded(
          flex: 6,
          child: Stack(
            children: [
              FlutterMap(
                options: MapOptions(
                  initialCenter: LatLng(13.0827, 80.2707),
                  initialZoom: 7.0,
                ),
                children: [
                  TileLayer(
                    urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                    userAgentPackageName: 'com.truxify.customer',
                  ),
                  PolylineLayer(
                    polylines: [
                      Polyline(
                        points: _routePoints,
                        color: Colors.blue,
                        strokeWidth: 4.0,
                      ),
                    ],
                  ),
                ],
              ),
              Positioned(
                top: 16,
                right: 16,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(8.0),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: const [
                        Icon(Icons.circle, color: Colors.green, size: 12),
                        SizedBox(width: 6),
                        Text('14 Nearby Trucks Online', style: TextStyle(fontWeight: FontWeight.bold)),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  // Fallback Mobile Sequential Layout
  Widget _buildMobileWizardLayout() {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: const [
            Icon(Icons.phone_android, size: 48, color: Colors.grey),
            SizedBox(height: 16),
            Text('Mobile sequential wizard view active.', style: TextStyle(fontSize: 16)),
          ],
        ),
      ),
    );
  }
}
