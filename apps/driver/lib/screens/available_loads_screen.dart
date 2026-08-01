import 'package:flutter/material.dart';

import '../core/app_routes.dart';
import '../models/app_models.dart';

class AvailableLoadsScreen extends StatelessWidget {
  const AvailableLoadsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Available Loads'),
        centerTitle: true,
      ),
      body: Column(
        children: [
          // Filtering UI (Placeholder)
          Padding(
            padding: const EdgeInsets.all(16.0),
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(
                children: [
                  FilterChip(
                    label: const Text('Near me'),
                    selected: true,
                    onSelected: (bool selected) {},
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('High Paying'),
                    selected: false,
                    onSelected: (bool selected) {},
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('Matches Route'),
                    selected: false,
                    onSelected: (bool selected) {},
                  ),
                ],
              ),
            ),
          ),
          
          // Loads List
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              itemCount: 10, // Dummy count
              itemBuilder: (context, index) {
                return _buildLoadCard(context, index);
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadCard(BuildContext context, int index) {
    // Dummy data generation based on index
    final origin = index % 2 == 0 ? "Mumbai, MH" : "Delhi, DL";
    final destination = index % 2 == 0 ? "Pune, MH" : "Jaipur, RJ";
    final distance = 150 + (index * 45); // km
    final weight = 5.0 + index; // tons
    final profitMargin = 2500 + (index * 500); // INR estimated profit
    final load = LoadOffer(
      id: 'available-load-$index',
      route: '$origin → $destination',
      customer: 'Customer',
      company: 'Marketplace',
      goods: 'General freight',
      pickup: origin,
      distanceFromDriver: '—',
      estimatedProfit: '₹$profitMargin',
      fuelCost: '₹0',
      tollCost: '₹0',
      capacityUsed: 0,
      truckFillLabel: 'Capacity',
      sharingTruckWith: '—',
      badgeLabel: 'Available',
      badgeEmoji: '',
      routeDistance: '$distance km',
      routeDuration: '—',
      weight: '$weight Tons',
      dimensions: '—',
      stackable: '—',
      fragile: '—',
      specialHandling: '',
      freightValue: '₹$profitMargin',
      netProfit: '₹$profitMargin',
      routeNote: '',
      extraDistance: 0,
      extraEarnings: '₹0',
      spaceAvailable: '—',
      updatedTotalEarnings: '—',
    );

    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 16.0),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            // Locations Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Origin',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        origin,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                const Icon(Icons.arrow_forward_outlined, color: Colors.blueAccent),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      Text(
                        'Destination',
                        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: Colors.grey),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        destination,
                        style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            
            const Divider(height: 32),
            
            // Stats Row
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildStatColumn(context, Icons.route, '$distance km'),
                _buildStatColumn(context, Icons.scale, '$weight Tons'),
                _buildStatColumn(
                  context, 
                  Icons.account_balance_wallet, 
                  '₹$profitMargin', 
                  isHighlight: true
                ),
              ],
            ),
            
            const SizedBox(height: 16),
            
            // Action Button
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {
                  Navigator.of(context).pushNamed(
                    AppRoutes.loadDetail,
                    arguments: load,
                  );
                },
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: const Text('View Details'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatColumn(BuildContext context, IconData icon, String value, {bool isHighlight = false}) {
    return Column(
      children: [
        Icon(icon, size: 20, color: isHighlight ? Colors.green : Colors.grey[600]),
        const SizedBox(height: 4),
        Text(
          value,
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
            fontWeight: isHighlight ? FontWeight.bold : FontWeight.normal,
            color: isHighlight ? Colors.green[700] : null,
          ),
        ),
      ],
    );
  }
}
