import 'package:flutter/material.dart';
import '../models/workshop_inventory_model.dart';
import '../services/parts_marketplace_service.dart';
import 'package:intl/intl.dart';

class BreakdownWorkshopLocatorScreen extends StatefulWidget {
  const BreakdownWorkshopLocatorScreen({super.key});

  @override
  State<BreakdownWorkshopLocatorScreen> createState() => _BreakdownWorkshopLocatorScreenState();
}

class _BreakdownWorkshopLocatorScreenState extends State<BreakdownWorkshopLocatorScreen> {
  final PartsMarketplaceService _marketplaceService = PartsMarketplaceService();
  List<WorkshopInventory> _workshops = [];
  bool _isSearching = false;
  bool _hasSearched = false;

  final String _detectedFault = 'P0562 (System Voltage Low)';
  final String _partRequired = 'Heavy Duty Alternator (Delco Remy 38MT)';

  void _searchInventory() async {
    setState(() {
      _isSearching = true;
    });

    final results = await _marketplaceService.locatePartAndWorkshop(
      faultCode: _detectedFault,
      partRequired: _partRequired,
      currentLat: 40.0,
      currentLng: -80.0,
    );

    // Sort by best match (has stock, closest distance)
    results.sort((a, b) {
      if (a.hasPartInStock && !b.hasPartInStock) return -1;
      if (!a.hasPartInStock && b.hasPartInStock) return 1;
      return a.distanceMiles.compareTo(b.distanceMiles);
    });

    if (mounted) {
      setState(() {
        _workshops = results;
        _isSearching = false;
        _hasSearched = true;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Workshop & Parts Locator'),
        backgroundColor: Colors.red[900],
      ),
      backgroundColor: Colors.grey[100],
      body: Column(
        children: [
          _buildBreakdownHeader(),
          if (_isSearching)
            const Expanded(
              child: Center(
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    CircularProgressIndicator(color: Colors.red),
                    SizedBox(height: 16),
                    Text('Querying national parts inventory...'),
                  ],
                ),
              ),
            )
          else if (!_hasSearched)
            Expanded(
              child: Center(
                child: ElevatedButton.icon(
                  onPressed: _searchInventory,
                  icon: const Icon(Icons.search),
                  label: const Text('FIND REQUIRED PARTS NEARBY'),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.red[900],
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16),
                  ),
                ),
              ),
            )
          else
            Expanded(
              child: ListView.builder(
                padding: const EdgeInsets.all(16.0),
                itemCount: _workshops.length,
                itemBuilder: (context, index) {
                  return _buildWorkshopCard(_workshops[index]);
                },
              ),
            )
        ],
      ),
    );
  }

  Widget _buildBreakdownHeader() {
    return Container(
      width: double.infinity,
      color: Colors.red[50],
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Row(
            children: [
              Icon(Icons.warning_amber_rounded, color: Colors.red, size: 32),
              SizedBox(width: 12),
              Text('ACTIVE FAULT DETECTED', style: TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 18, letterSpacing: 1)),
            ],
          ),
          const SizedBox(height: 16),
          Text(_detectedFault, style: const TextStyle(fontSize: 22, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text('Required Part: $_partRequired', style: TextStyle(color: Colors.grey[800], fontSize: 16)),
        ],
      ),
    );
  }

  Widget _buildWorkshopCard(WorkshopInventory ws) {
    final timeFormat = DateFormat('h:mm a');
    
    return Card(
      margin: const EdgeInsets.only(bottom: 16.0),
      shape: RoundedRectangleBorder(
        side: BorderSide(color: ws.hasPartInStock ? Colors.green : Colors.grey[300]!, width: 2),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(child: Text(ws.workshopName, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold))),
                Text('${ws.distanceMiles} mi', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
              ],
            ),
            const SizedBox(height: 8),
            Text(ws.address, style: const TextStyle(color: Colors.grey)),
            const Divider(height: 32),
            Row(
              children: [
                Icon(
                  ws.hasPartInStock ? Icons.check_circle : Icons.cancel,
                  color: ws.hasPartInStock ? Colors.green : Colors.red,
                ),
                const SizedBox(width: 8),
                Text(
                  ws.hasPartInStock ? 'Part In Stock (\$${ws.estimatedPartCost})' : 'Out of Stock',
                  style: TextStyle(
                    fontWeight: FontWeight.bold,
                    color: ws.hasPartInStock ? Colors.green[800] : Colors.red[800],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                const Icon(Icons.build, color: Colors.orange),
                const SizedBox(width: 8),
                Text(
                  'Next Bay Available: ${timeFormat.format(ws.nextAvailableSlot)}',
                  style: const TextStyle(color: Colors.deepOrange, fontWeight: FontWeight.bold),
                ),
              ],
            ),
            if (ws.hasPartInStock) ...[
              const SizedBox(height: 24),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: () {
                    ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Routing to workshop...')));
                  },
                  style: ElevatedButton.styleFrom(backgroundColor: Colors.red[900], foregroundColor: Colors.white),
                  child: const Text('ROUTE HERE & HOLD PART'),
                ),
              )
            ]
          ],
        ),
      ),
    );
  }
}
