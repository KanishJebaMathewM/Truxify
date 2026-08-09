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

class _AvailableLoadsScreenState extends State<AvailableLoadsScreen> {
  late final MarketplaceRepository _repository =
      widget._repository ?? MarketplaceRepository();
  late Future<List<LoadOffer>> _loadsFuture;

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

                final loads = snapshot.data ?? const <LoadOffer>[];
                if (loads.isEmpty) {
                  return _MessageState(
                    icon: Icons.inventory_2_outlined,
                    title: 'No loads available',
                    message: 'New load offers will appear here as they become available.',
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
                  context,
                  Icons.account_balance_wallet,
                  load.estimatedProfit,
                  isHighlight: true,
                ),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () {},
                style: ElevatedButton.styleFrom(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(8),
                  ),
                ),
                child: const Text('View Details'),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildStatColumn(
    BuildContext context,
    IconData icon,
    String value, {
    bool isHighlight = false,
  }) {
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
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(icon, size: 48, color: Colors.grey[600]),
            const SizedBox(height: 12),
            Text(
              title,
              style: Theme.of(context).textTheme.titleMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),
            Text(
              message,
              style: Theme.of(context).textTheme.bodyMedium,
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 16),
            OutlinedButton(
              onPressed: onAction,
              child: Text(actionLabel),
            ),
          ],
        ),
      ),
    );
  }
}
