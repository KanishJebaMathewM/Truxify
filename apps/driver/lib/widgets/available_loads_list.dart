import 'package:flutter/material.dart';

class AvailableLoadsList extends StatefulWidget {
  const AvailableLoadsList({super.key});

  @override
  State<AvailableLoadsList> createState() => _AvailableLoadsListState();
}

class _AvailableLoadsListState extends State<AvailableLoadsList> {
  final ScrollController _scrollController = ScrollController();
  final List<Map<String, dynamic>> _loads = [];
  bool _isLoading = false;
  bool _hasMore = true;
  int _page = 1;

  @override
  void initState() {
    super.initState();
    _fetchLoads();
    _scrollController.addListener(() {
      if (_scrollController.position.pixels ==
          _scrollController.position.maxScrollExtent) {
        _fetchMoreLoads();
      }
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _fetchLoads() async {
    setState(() {
      _isLoading = true;
    });

    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));

    final newLoads = List.generate(10, (index) => _generateMockLoad(index));
    
    if (mounted) {
      setState(() {
        _loads.clear();
        _loads.addAll(newLoads);
        _isLoading = false;
        _page = 2;
        _hasMore = true;
      });
    }
  }

  Future<void> _fetchMoreLoads() async {
    if (_isLoading || !_hasMore) return;

    setState(() {
      _isLoading = true;
    });

    // Simulate network delay
    await Future.delayed(const Duration(seconds: 1));

    // Simulate end of data after 3 pages
    if (_page > 3) {
      if (mounted) {
        setState(() {
          _isLoading = false;
          _hasMore = false;
        });
      }
      return;
    }

    final newLoads = List.generate(
        10, (index) => _generateMockLoad((_page - 1) * 10 + index));

    if (mounted) {
      setState(() {
        _loads.addAll(newLoads);
        _isLoading = false;
        _page++;
      });
    }
  }

  Map<String, dynamic> _generateMockLoad(int index) {
    return {
      'id': 'LD-${1000 + index}',
      'pickup': 'Warehouse A, Mumbai',
      'drop': 'Distribution Center, Delhi',
      'distance': '${1200 + (index * 10)} km',
      'weight': '${15 + (index % 5)} Tons',
      'profit': '₹${25000 + (index * 1000)}',
    };
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _fetchLoads,
      child: _loads.isEmpty && _isLoading
          ? const Center(child: CircularProgressIndicator())
          : ListView.builder(
              controller: _scrollController,
              padding: const EdgeInsets.all(16.0),
              itemCount: _loads.length + (_hasMore ? 1 : 0),
              itemBuilder: (context, index) {
                if (index == _loads.length) {
                  return const Padding(
                    padding: EdgeInsets.symmetric(vertical: 16.0),
                    child: Center(child: CircularProgressIndicator()),
                  );
                }
                final load = _loads[index];
                return Padding(
                  padding: const EdgeInsets.only(bottom: 12.0),
                  child: LoadCard(load: load),
                );
              },
            ),
    );
  }
}

class LoadCard extends StatelessWidget {
  final Map<String, dynamic> load;

  const LoadCard({super.key, required this.load});

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    
    return Card(
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text(
                  load['id'],
                  style: theme.textTheme.labelMedium?.copyWith(
                    color: theme.colorScheme.primary,
                    fontWeight: FontWeight.bold,
                  ),
                ),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.green.withOpacity(0.1),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    load['profit'],
                    style: const TextStyle(
                      color: Colors.green,
                      fontWeight: FontWeight.bold,
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            _buildLocationRow(context, Icons.my_location, 'Pickup', load['pickup'], theme.colorScheme.primary),
            _buildConnectorLine(theme),
            _buildLocationRow(context, Icons.location_on, 'Drop', load['drop'], Colors.red),
            const SizedBox(height: 16),
            const Divider(),
            const SizedBox(height: 8),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildInfoChip(context, Icons.route, load['distance']),
                _buildInfoChip(context, Icons.scale, load['weight']),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildLocationRow(BuildContext context, IconData icon, String label, String location, Color iconColor) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, size: 20, color: iconColor),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                label,
                style: Theme.of(context).textTheme.bodySmall?.copyWith(
                  color: Theme.of(context).textTheme.bodySmall?.color?.withOpacity(0.6),
                ),
              ),
              Text(
                location,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildConnectorLine(ThemeData theme) {
    return Container(
      margin: const EdgeInsets.only(left: 9, top: 4, bottom: 4),
      height: 20,
      width: 2,
      color: theme.dividerColor,
    );
  }

  Widget _buildInfoChip(BuildContext context, IconData icon, String text) {
    return Row(
      children: [
        Icon(icon, size: 16, color: Theme.of(context).textTheme.bodySmall?.color),
        const SizedBox(width: 6),
        Text(
          text,
          style: Theme.of(context).textTheme.bodySmall?.copyWith(
            fontWeight: FontWeight.w500,
          ),
        ),
      ],
    );
  }
}
