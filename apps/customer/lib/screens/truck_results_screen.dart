import 'package:flutter/material.dart';
import 'package:truxify/theme/app_theme.dart';

import '../models/app_models.dart';
import '../services/order_service.dart';
import '../widgets/truck_card.dart';
import 'package:truxify_shared/shimmer_widget.dart';

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
  late RouteDraft _activeDraft;

  static const _sortChips = [
    'Best Match',
    'Cheapest',
    'Fastest',
    'Top Rated',
  ];

  bool get _hasActiveFilters =>
      _activeDraft.truckType != null ||
      _activeDraft.minCapacity != null ||
      _activeDraft.maxCapacity != null ||
      _activeDraft.materialType != null;

  @override
  void initState() {
    super.initState();
    _activeDraft = widget.draft;
    _fetchTrucks();
  }

  Future<void> _fetchTrucks() async {
    setState(() {
      _isLoading = true;
      _error = null;
    });

    try {
      final draft = _activeDraft;
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
        truckType: draft.truckType,
        minCapacity: draft.minCapacity,
        maxCapacity: draft.maxCapacity,
        materialType: draft.materialType,
      );

      if (!mounted) return;

      setState(() {
        _trucks = results.map((j) => TruckResultData.fromJson(j)).toList();
        _isLoading = false;
      });
    } catch (e) {
      if (!mounted) return;

      setState(() {
        _error = e.toString().replaceFirst('StateError: ', '');
        _isLoading = false;
      });
    }
  }

  void _clearFilters() {
    setState(() {
      _activeDraft = RouteDraft(
        pickup: _activeDraft.pickup,
        drop: _activeDraft.drop,
        dateLabel: _activeDraft.dateLabel,
        goodsType: _activeDraft.goodsType,
        weightTonnes: _activeDraft.weightTonnes,
        dimensions: _activeDraft.dimensions,
        stacked: _activeDraft.stacked,
        fragile: _activeDraft.fragile,
        requirements: _activeDraft.requirements,
        pickupDate: _activeDraft.pickupDate,
        pickupLat: _activeDraft.pickupLat,
        pickupLng: _activeDraft.pickupLng,
        dropLat: _activeDraft.dropLat,
        dropLng: _activeDraft.dropLng,
      );
    });
    _fetchTrucks();
  }

  List<String> get _activeFilterLabels {
    final labels = <String>[];
    if (_activeDraft.truckType != null) {
      labels.add('Type: ${_activeDraft.truckType}');
    }
    if (_activeDraft.minCapacity != null || _activeDraft.maxCapacity != null) {
      final min = _activeDraft.minCapacity?.toInt() ?? 0;
      final max = _activeDraft.maxCapacity?.toInt() ?? 25;
      labels.add('Capacity: ${min}t–${max}t');
    }
    if (_activeDraft.materialType != null) {
      labels.add('Material: ${_activeDraft.materialType}');
    }
    return labels;
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
      case 0:
        trucks.sort(
          (a, b) => (b.badge == 'Best Match' ? 1 : 0)
              .compareTo(a.badge == 'Best Match' ? 1 : 0),
        );
        break;
      case 1:
        trucks.sort((a, b) => _price(a.price).compareTo(_price(b.price)));
        break;
      case 2:
        trucks.sort((a, b) => _eta(a.eta).compareTo(_eta(b.eta)));
        break;
      case 3:
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
        body: ListView.builder(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
          itemCount: 5,
          itemBuilder: (_, __) => const ShimmerListItem(height: 140),
        ),
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
      final hasFilters = _hasActiveFilters;
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
                  hasFilters
                      ? 'No trucks match your current filters. Try clearing some filters to see more results.'
                      : 'No available trucks match your route and cargo. Try adjusting your search criteria.',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodyLarge,
                ),
                const SizedBox(height: 24),
                if (hasFilters)
                  FilledButton.icon(
                    onPressed: _clearFilters,
                    icon: const Icon(Icons.filter_alt_off_rounded),
                    label: const Text('Clear Filters'),
                  )
                else
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
          if (_hasActiveFilters) ...[
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                ..._activeFilterLabels.map(
                  (label) => Chip(
                    label: Text(label,
                        style: Theme.of(context).textTheme.labelSmall?.copyWith(
                              fontWeight: FontWeight.w600,
                            )),
                    backgroundColor: TruxifyColors.accentLight,
                    side: BorderSide.none,
                    padding: EdgeInsets.zero,
                    materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                    visualDensity: VisualDensity.compact,
                  ),
                ),
                ActionChip(
                  avatar: const Icon(Icons.close_rounded, size: 16),
                  label: Text('Clear Filters',
                      style: Theme.of(context).textTheme.labelSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                            color: Theme.of(context).colorScheme.error,
                          )),
                  backgroundColor: Theme.of(context).colorScheme.errorContainer,
                  side: BorderSide.none,
                  onPressed: _clearFilters,
                  padding: EdgeInsets.zero,
                  materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            const SizedBox(height: 12),
          ],
          ...results.asMap().entries.map(
            (entry) {
              return Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: TruckCard(
                  truck: entry.value,
                  draft: _activeDraft,
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
