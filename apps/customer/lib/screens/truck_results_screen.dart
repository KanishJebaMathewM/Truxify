import 'package:flutter/material.dart';
import 'package:truxify/theme/app_theme.dart';

import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../widgets/truck_card.dart';

class TruckResultsScreen extends StatefulWidget {
  const TruckResultsScreen({super.key, required this.draft});

  final RouteDraft draft;

  @override
  State<TruckResultsScreen> createState() => _TruckResultsScreenState();
}

class _TruckResultsScreenState extends State<TruckResultsScreen> {
  int _selectedSort = 0;
  static const _sortChips = ['Best Match', 'Cheapest', 'Fastest', 'Top Rated'];

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('${mockTruckResults.length} trucks found'),
        leading: IconButton(
            onPressed: () => Navigator.of(context).pop(),
            icon: const Icon(Icons.arrow_back_rounded)),
        actions: [
          IconButton(onPressed: () {}, icon: const Icon(Icons.sort_rounded))
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
                    color: selected
                        ? TruxifyColors.accent
                        : Colors.grey.shade300,
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
          ...mockTruckResults.asMap().entries.map(
            (entry) {
              final index = entry.key;
              final truck = entry.value;
              return Padding(
                padding: const EdgeInsets.only(bottom: 14),
                child: TruckCard(
                  truck: truck,
                  draft: widget.draft,
                  isHighlighted: index == 0,
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
