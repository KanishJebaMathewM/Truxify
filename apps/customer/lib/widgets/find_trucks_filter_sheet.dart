import 'package:flutter/material.dart';

class FindTrucksFilterSheet extends StatefulWidget {
  const FindTrucksFilterSheet({super.key});

  @override
  State<FindTrucksFilterSheet> createState() => _FindTrucksFilterSheetState();
}

class _FindTrucksFilterSheetState extends State<FindTrucksFilterSheet> {
  String _selectedGoodsType = 'Solid';
  double _weightInTons = 5.0;
  String _selectedTruckType = 'Open';

  final List<String> _goodsTypes = ['Fragile', 'Liquid', 'Solid', 'Agricultural'];
  final List<String> _truckTypes = ['Open', 'Container', 'Trailer'];

  void _onSearchPressed() {
    // In the future, this will trigger the API call to the ML matching service
    // with the selected filter parameters.
    final filters = {
      'goodsType': _selectedGoodsType,
      'weightTons': _weightInTons,
      'truckType': _selectedTruckType,
    };
    
    // Close the bottom sheet and return the filters
    Navigator.of(context).pop(filters);
  }

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(24.0),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(
            'Find Trucks',
            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                  fontWeight: FontWeight.bold,
                ),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          
          // Goods Type Dropdown
          Text(
            'Goods Type',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          DropdownButtonFormField<String>(
            value: _selectedGoodsType,
            decoration: const InputDecoration(
              border: OutlineInputBorder(),
              contentPadding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
            ),
            items: _goodsTypes.map((type) {
              return DropdownMenuItem(
                value: type,
                child: Text(type),
              );
            }).toList(),
            onChanged: (value) {
              if (value != null) {
                setState(() {
                  _selectedGoodsType = value;
                });
              }
            },
          ),
          const SizedBox(height: 20),

          // Weight Slider
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'Weight (Tons)',
                style: Theme.of(context).textTheme.titleSmall,
              ),
              Text(
                '${_weightInTons.toStringAsFixed(1)} t',
                style: Theme.of(context).textTheme.titleMedium?.copyWith(
                      fontWeight: FontWeight.bold,
                      color: Theme.of(context).colorScheme.primary,
                    ),
              ),
            ],
          ),
          Slider(
            value: _weightInTons,
            min: 0.5,
            max: 40.0,
            divisions: 79,
            label: '${_weightInTons.toStringAsFixed(1)} tons',
            onChanged: (value) {
              setState(() {
                _weightInTons = value;
              });
            },
          ),
          const SizedBox(height: 12),

          // Truck Type Choice Chips
          Text(
            'Preferred Truck Type',
            style: Theme.of(context).textTheme.titleSmall,
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8.0,
            children: _truckTypes.map((type) {
              final isSelected = _selectedTruckType == type;
              return ChoiceChip(
                label: Text(type),
                selected: isSelected,
                onSelected: (selected) {
                  if (selected) {
                    setState(() {
                      _selectedTruckType = type;
                    });
                  }
                },
              );
            }).toList(),
          ),
          const SizedBox(height: 32),

          // Search CTA Button
          ElevatedButton(
            onPressed: _onSearchPressed,
            style: ElevatedButton.styleFrom(
              padding: const EdgeInsets.symmetric(vertical: 16),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(12),
              ),
            ),
            child: const Text(
              'Search Trucks',
              style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ),
          const SizedBox(height: 16), // Padding for safe area at bottom
        ],
      ),
    );
  }
}
