import 'package:flutter/material.dart';

enum _LoadFilter { nearMe, highPaying, matchesRoute }

class AvailableLoadsScreen extends StatefulWidget {
  const AvailableLoadsScreen({super.key});

  @override
  State<AvailableLoadsScreen> createState() => _AvailableLoadsScreenState();
}

class _AvailableLoadsScreenState extends State<AvailableLoadsScreen> {
  _LoadFilter _selectedFilter = _LoadFilter.nearMe;

  @override
  Widget build(BuildContext context) {
    final indexes = List<int>.generate(10, (index) => index).where(_matchesFilter).toList();

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
                    selected: _selectedFilter == _LoadFilter.nearMe,
                    onSelected: (_) => _selectFilter(_LoadFilter.nearMe),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('High Paying'),
                    selected: _selectedFilter == _LoadFilter.highPaying,
                    onSelected: (_) => _selectFilter(_LoadFilter.highPaying),
                  ),
                  const SizedBox(width: 8),
                  FilterChip(
                    label: const Text('Matches Route'),
                    selected: _selectedFilter == _LoadFilter.matchesRoute,
                    onSelected: (_) => _selectFilter(_LoadFilter.matchesRoute),
                  ),
                ],
              ),
            ),
          ),
          
          // Loads List
          Expanded(
            child: ListView.builder(
              padding: const EdgeInsets.symmetric(horizontal: 16.0),
              itemCount: indexes.length,
              itemBuilder: (context, index) {
                return _buildLoadCard(context, indexes[index]);
              },
            ),
          ),
        ],
      ),
    );
  }

  void _selectFilter(_LoadFilter filter) {
    setState(() {
      _selectedFilter = filter;
    });
  }

  bool _matchesFilter(int index) {
    switch (_selectedFilter) {
      case _LoadFilter.nearMe:
        return index < 5;
      case _LoadFilter.highPaying:
        return 2500 + (index * 500) >= 5000;
      case _LoadFilter.matchesRoute:
        return index.isEven;
    }
  }

  Widget _buildLoadCard(BuildContext context, int index) {
    // Dummy data generation based on index
    final origin = index % 2 == 0 ? "Mumbai, MH" : "Delhi, DL";
    final destination = index % 2 == 0 ? "Pune, MH" : "Jaipur, RJ";
    final distance = 150 + (index * 45); // km
    final weight = 5.0 + index; // tons
    final profitMargin = 2500 + (index * 500); // INR estimated profit

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
                  // TODO: Navigate to load details or accept load
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
