import 'package:flutter/material.dart';

import '../models/app_models.dart';
import '../services/marketplace_repository.dart';

class AvailableLoadsScreen extends StatefulWidget {
  const AvailableLoadsScreen({
    super.key,
    MarketplaceRepository? repository,
  }) : _repository = repository;

  final MarketplaceRepository? _repository;

  @override
  State<AvailableLoadsScreen> createState() => _AvailableLoadsScreenState();
}

/// Which quick filter chip is active on the available loads list.
enum _LoadFilter { nearMe, highPaying, matchesRoute }

class _AvailableLoadsScreenState extends State<AvailableLoadsScreen> {
  late final MarketplaceRepository _repository =
      widget._repository ?? MarketplaceRepository();
  late Future<List<LoadOffer>> _loadsFuture;
  _LoadFilter _selectedFilter = _LoadFilter.nearMe;

  @override
  void initState() {
    super.initState();
    _loadsFuture = _repository.fetchLoadOffers();
  }

  @override
  void dispose() {
    if (widget._repository == null) {
      _repository.dispose();
    }
    super.dispose();
  }

  void _refreshLoads() {
    setState(() {
      _loadsFuture = _repository.fetchLoadOffers();
    });
  }

  void _selectFilter(_LoadFilter filter) {
    setState(() => _selectedFilter = filter);
  }

  /// Filter/sort the loaded offers for the active chip. nearMe sorts by
  /// distance, highPaying by net profit, matchesRoute surfaces the badge
  /// flagged bestProfit first.
  List<LoadOffer> _applyFilter(List<LoadOffer> loads) {
    final sorted = [...loads];
    switch (_selectedFilter) {
      case _LoadFilter.nearMe:
        sorted.sort((a, b) =>
            a.distanceFromDriver.compareTo(b.distanceFromDriver));
      case _LoadFilter.highPaying:
        sorted.sort((a, b) => b.netProfit.compareTo(a.netProfit));
      case _LoadFilter.matchesRoute:
        sorted.sort((a, b) => (b.bestProfit ? 1 : 0) - (a.bestProfit ? 1 : 0));
    }
    return sorted;
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Available Loads'),
        centerTitle: true,
      ),
      body: Column(
        children: [
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
          Expanded(
            child: FutureBuilder<List<LoadOffer>>(
              future: _loadsFuture,
              builder: (context, snapshot) {
                if (snapshot.connectionState == ConnectionState.waiting) {
                  return const Center(child: CircularProgressIndicator());
                }

                if (snapshot.hasError) {
                  return _MessageState(
                    icon: Icons.error_outline,
                    title: 'Could not load available loads',
                    message: snapshot.error.toString(),
                    actionLabel: 'Retry',
                    onAction: _refreshLoads,
                  );
                }

                final loads =
                    _applyFilter(snapshot.data ?? const <LoadOffer>[]);
                if (loads.isEmpty) {
                  return _MessageState(
                    icon: Icons.inventory_2_outlined,
                    title: 'No loads available',
                    message:
                        'New load offers will appear here as they become available.',
                    actionLabel: 'Refresh',
                    onAction: _refreshLoads,
                  );
                }

                return RefreshIndicator(
                  onRefresh: () async => _refreshLoads(),
                  child: ListView.builder(
                    padding: const EdgeInsets.symmetric(horizontal: 16.0),
                    itemCount: loads.length,
                    itemBuilder: (context, index) {
                      return _buildLoadCard(context, loads[index]);
                    },
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildLoadCard(BuildContext context, LoadOffer load) {
    return Card(
      elevation: 2,
      margin: const EdgeInsets.only(bottom: 16.0),
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        'Route',
                        style: Theme.of(context)
                            .textTheme
                            .bodySmall
                            ?.copyWith(color: Colors.grey),
                      ),
                      const SizedBox(height: 4),
                      Text(
                        load.route,
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 12),
                Chip(label: Text(load.badgeLabel)),
              ],
            ),
            const Divider(height: 32),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildStatColumn(context, Icons.route, load.routeDistance),
                _buildStatColumn(context, Icons.scale, load.weight),
                _buildStatColumn(
                    context, Icons.payments_outlined, load.estimatedProfit),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatColumn(BuildContext context, IconData icon, String value) {
    return Column(
      children: [
        Icon(icon, size: 18, color: Colors.grey),
        const SizedBox(height: 4),
        Text(value,
            style: Theme.of(context)
                .textTheme
                .bodySmall
                ?.copyWith(fontWeight: FontWeight.w600)),
      ],
    );
  }
}

class _MessageState extends StatelessWidget {
  const _MessageState({
    required this.icon,
    required this.title,
    required this.message,
    required this.actionLabel,
    required this.onAction,
  });

  final IconData icon;
  final String title;
  final String message;
  final String actionLabel;
  final VoidCallback onAction;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(32.0),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Colors.grey),
            const SizedBox(height: 12),
            Text(title,
                style: Theme.of(context)
                    .textTheme
                    .titleMedium
                    ?.copyWith(fontWeight: FontWeight.bold)),
            const SizedBox(height: 6),
            Text(message, textAlign: TextAlign.center),
            const SizedBox(height: 16),
            TextButton(onPressed: onAction, child: Text(actionLabel)),
          ],
        ),
      ),
    );
  }
}
