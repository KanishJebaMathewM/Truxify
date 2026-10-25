import 'package:flutter/material.dart';

class LoadPostingScreen extends StatefulWidget {
  const LoadPostingScreen({super.key});

  @override
  State<LoadPostingScreen> createState() => _LoadPostingScreenState();
}

class _LoadPostingScreenState extends State<LoadPostingScreen> {
  int _currentStep = 0;

  // Controllers for Step 1: Location
  final TextEditingController _pickupController = TextEditingController();
  final TextEditingController _dropoffController = TextEditingController();

  // Controllers/State for Step 2: Cargo Details
  final TextEditingController _weightController = TextEditingController();
  final TextEditingController _materialController = TextEditingController();
  String? _selectedTruckType;
  final List<String> _truckTypes = [
    'Light Commercial Vehicle (LCV)',
    'Medium Duty Truck',
    'Heavy Duty Truck',
    'Trailer',
    'Refrigerated (Reefer)',
  ];
// apps/customer/lib/screens/load_posting_screen.dart

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
  // Controllers for Step 3: Pricing
  final TextEditingController _budgetController = TextEditingController();

  @override
  void dispose() {
    _pickupController.dispose();
    _dropoffController.dispose();
    _weightController.dispose();
    _materialController.dispose();
    _budgetController.dispose();
    super.dispose();
  }

  void _submitLoad() {
    final missingFields = <String>[
      if (_pickupController.text.trim().isEmpty) 'pick-up location',
      if (_dropoffController.text.trim().isEmpty) 'drop-off location',
      if (_selectedTruckType == null) 'truck type',
      if (_weightController.text.trim().isEmpty) 'weight',
      if (_materialController.text.trim().isEmpty) 'material',
      if (_budgetController.text.trim().isEmpty) 'budget',
    ];

    if (missingFields.isNotEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Please enter ${missingFields.join(', ')}.'),
          backgroundColor: Colors.orange,
        ),
      );
      return;
    }

    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Load posting is not connected yet. Please try again after backend submission is enabled.'),
        backgroundColor: Colors.red,
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Post a Load'),
        centerTitle: true,
      ),
      body: Stepper(
        type: StepperType.vertical,
        currentStep: _currentStep,
        onStepContinue: () {
          if (_currentStep < 2) {
            setState(() {
              _currentStep += 1;
            });
          } else {
            _submitLoad();
          }
        },
        onStepCancel: () {
          if (_currentStep > 0) {
            setState(() {
              _currentStep -= 1;
            });
          }
        },
        controlsBuilder: (BuildContext context, ControlsDetails details) {
          final isLastStep = _currentStep == 2;
          return Padding(
            padding: const EdgeInsets.only(top: 24.0),
            child: Row(
              children: [
                Expanded(
                  child: ElevatedButton(
                    onPressed: details.onStepContinue,
                    style: ElevatedButton.styleFrom(
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(8),
                      ),
                    ),
                    child: Text(isLastStep ? 'Post Load' : 'Continue'),
                  ),
                ),
                if (_currentStep > 0) const SizedBox(width: 12),
                if (_currentStep > 0)
                  Expanded(
                    child: OutlinedButton(
                      onPressed: details.onStepCancel,
                      style: OutlinedButton.styleFrom(
                        padding: const EdgeInsets.symmetric(vertical: 14),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(8),
                        ),
                      ),
                      child: const Text('Back'),
                    ),
                  ),
              ],
            ),
          );
        },
        steps: [
          Step(
            title: const Text('Location Details', style: TextStyle(fontWeight: FontWeight.bold)),
            content: Column(
              children: [
                TextFormField(
                  controller: _pickupController,
                  decoration: const InputDecoration(
                    labelText: 'Pick-up Location',
                    hintText: 'Enter origin city or address',
                    prefixIcon: Icon(Icons.location_searching),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _dropoffController,
                  decoration: const InputDecoration(
                    labelText: 'Drop-off Location',
                    hintText: 'Enter destination city or address',
                    prefixIcon: Icon(Icons.location_on),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Note: Full place autocomplete will be enabled shortly.',
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
            isActive: _currentStep >= 0,
            state: _currentStep > 0 ? StepState.complete : StepState.indexed,
          ),
          Step(
            title: const Text('Cargo Details', style: TextStyle(fontWeight: FontWeight.bold)),
            content: Column(
              children: [
                DropdownButtonFormField<String>(
                  decoration: const InputDecoration(
                    labelText: 'Required Truck Type',
                    prefixIcon: Icon(Icons.local_shipping),
                    border: OutlineInputBorder(),
                  ),
                  initialValue: _selectedTruckType,
                  items: _truckTypes.map((type) {
                    return DropdownMenuItem(
                      value: type,
                      child: Text(type),
                    );
                  }).toList(),
                  onChanged: (value) {
                    setState(() {
                      _selectedTruckType = value;
                    });
                  },
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _weightController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Total Weight (Tons)',
                    hintText: 'e.g. 15',
                    prefixIcon: Icon(Icons.scale),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 16),
                TextFormField(
                  controller: _materialController,
                  decoration: const InputDecoration(
                    labelText: 'Material / Commodity Type',
                    hintText: 'e.g. Steel, Electronics, Textiles',
                    prefixIcon: Icon(Icons.inventory_2),
                    border: OutlineInputBorder(),
                  ),
                ),
              ],
            ),
            isActive: _currentStep >= 1,
            state: _currentStep > 1 ? StepState.complete : StepState.indexed,
          ),
          Step(
            title: const Text('Pricing', style: TextStyle(fontWeight: FontWeight.bold)),
            content: Column(
              children: [
                TextFormField(
                  controller: _budgetController,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(
                    labelText: 'Expected Budget (INR)',
                    hintText: 'e.g. 15000',
                    prefixIcon: Icon(Icons.currency_rupee),
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 12),
                const Text(
                  'Providing an accurate budget helps attract better matches.',
                  style: TextStyle(color: Colors.grey, fontSize: 12),
                ),
              ],
            ),
            isActive: _currentStep >= 2,
            state: StepState.indexed,
          ),
        ],
      ),
    );
  }
}
