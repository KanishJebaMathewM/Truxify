import 'package:flutter/material.dart';
import 'package:truxify/theme/app_theme.dart';

import '../models/app_models.dart';
import '../services/order_service.dart';
import '../widgets/truck_card.dart';

class TruckResultsScreen extends StatefulWidget {
  const TruckResultsScreen({super.key, required this.draft});

  final RouteDraft draft;

  @override
  State<TruckResultsScreen> createState() => _TruckResultsScreenState();
}

class _TruckResultsScreenState extends State<TruckResultsScreen> {
  int _selectedSort = 0;
  List<TruckResultData>? _trucks;
  bool _isLoading = true;
  String? _error;

  static const _sortChips = [
    'Best Match',
    'Cheapest',
    'Fastest',
    'Top Rated',
  ];

  @override
  void initState() {
    super.initState();
    _fetchTrucks();
  }

  Future<void> _fetchTrucks() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final draft = widget.draft;
      final weight = double.tryParse(draft.weightTonnes) ?? 0;

      if (draft.pickupLat == null || draft.pickupLng == null ||
          draft.dropLat == null || draft.dropLng == null) {
        setState(() {
          _error = 'Please select pickup and drop locations on the map.';
          _isLoading = false;
        });
        return;
      }

      final service = OrderService();
      final results = await service.searchTrucks(
        pickupLat: draft.pickupLat!,
        pickupLng: draft.pickupLng!,
        dropLat: draft.dropLat!,
        dropLng: draft.dropLng!,
        weightTonnes: weight,
        isFragile: draft.fragile,
        isStackable: draft.stacked,
      );

      setState(() {
        _trucks = results.map((j) => TruckResultData.fromJson(j)).toList();
        _isLoading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString().replaceFirst('StateError: ', '');
        _isLoading = false;
      });
    }
  }

  int _price(String price) {
    return int.parse(
      price.replaceAll('₹', '').replaceAll(',', '').trim(),
    );
  }

  double _eta(String eta) {
    if (eta.contains('mins')) {
      return double.parse(eta.replaceAll('mins', '').trim());
    }
    if (eta.contains('hrs')) {
      return double.parse(eta.replaceAll('hrs', '').trim()) * 60;
    }
    return double.infinity;
  }

  List<TruckResultData> get sortedTrucks {
    final trucks = List<TruckResultData>.from(_trucks ?? []);

    switch (_selectedSort) {
      case 0: // Best Match
        trucks.sort(
          (a, b) => (b.badge == 'Best Match' ? 1 : 0)
              .compareTo(a.badge == 'Best Match' ? 1 : 0),
        );
        break;
      case 1: // Cheapest
        trucks.sort((a, b) => _price(a.price).compareTo(_price(b.price)));
        break;
      case 2: // Fastest
        trucks.sort((a, b) => _eta(a.eta).compareTo(_eta(b.eta)));
        break;
      case 3: // Top Rated
        trucks.sort((a, b) => b.rating.compareTo(a.rating));
        break;
      default:
        break;
    }

    return trucks;
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Finding trucks...'),
          leading: IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        ),
        body: const Center(child: CircularProgressIndicator()),
      );
    }

    if (_error != null) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('Search Failed'),
          leading: IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.error_outline_rounded, size: 48,
                    color: Theme.of(context).colorScheme.error),
                const SizedBox(height: 16),
                Text(
                  _error!,
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 24),
                FilledButton.icon(
                  onPressed: _fetchTrucks,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Retry'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    if (_trucks == null || _trucks!.isEmpty) {
      return Scaffold(
        appBar: AppBar(
          title: const Text('No trucks found'),
          leading: IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded),
          ),
        ),
        body: Center(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.local_shipping_rounded, size: 48,
                    color: TruxifyColors.adaptiveSecondaryText(context)),
                const SizedBox(height: 16),
                Text(
                  'No available trucks match your route and cargo. Try adjusting your search criteria.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () => Navigator.of(context).pop(),
                  child: const Text('Adjust Search'),
                ),
              ],
            ),
          ),
        ),
      );
    }

    final results = sortedTrucks;

    return Scaffold(
      appBar: AppBar(
        title: Text('${results.length} trucks found'),
        leading: IconButton(
          onPressed: () => Navigator.of(context).pop(),
          icon: const Icon(Icons.arrow_back_rounded),
        ),
        actions: [
          IconButton(
            onPressed: _fetchTrucks,
            icon: const Icon(Icons.refresh_rounded),
          ),
        ],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          SizedBox(
            height: 44,
            child: ListView.separated(
              scrollDirection: Axis.horizontal,
              itemCount: _sortChips.length,
              separatorBuilder: (_, __) => const SizedBox(width: 10),
              itemBuilder: (context, index) {
                final selected = index == _selectedSort;
                return ChoiceChip(
                  label: Text(
                    _sortChips[index],
                    style: TextStyle(
                      color: selected
                          ? Colors.white
                          : Theme.of(context).brightness == Brightness.dark
                              ? Colors.white70
                              : Colors.black87,
                      fontWeight: FontWeight.w600,
                      fontSize: 15,
                    ),
                  ),
                  selected: selected,
                  onSelected: (_) => setState(() => _selectedSort = index),
                  selectedColor: TruxifyColors.accent,
                  backgroundColor:
                      Theme.of(context).brightness == Brightness.dark
                          ? TruxifyColors.darkBackground
                          : Colors.white,
                  side: BorderSide(
                    color:
                        selected ? TruxifyColors.accent : Colors.grey.shade300,
                    width: 1.2,
                  ),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(16),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: 16,
                    vertical: 8,
                  ),
                  showCheckmark: true,
                  checkmarkColor: Colors.white,
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          ...results.asMap().entries.map(
            (entry) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: TruckCard(
                  truck: entry.value,
                  draft: widget.draft,
                  isHighlighted: entry.key == 0,
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
