import 'package:flutter/material.dart';

import '../controllers/app_controller.dart';
import '../data/mock_data.dart';
import '../models/app_models.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';
import '../widgets/timeline_row.dart';

class OrderDetailScreen extends StatefulWidget {
  const OrderDetailScreen({super.key, required this.order});

  final HistoryOrderData order;

  @override
  State<OrderDetailScreen> createState() => _OrderDetailScreenState();
}

class _OrderDetailScreenState extends State<OrderDetailScreen> {
  int _rating = 0;
  final TextEditingController _commentController = TextEditingController();

  @override
  void dispose() {
    _commentController.dispose();
    super.dispose();
  }

  void _submitRating() {
    if (_rating == 0) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Please select a rating before submitting.')),
      );
      return;
    }

    final comment = _commentController.text.trim();
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text(
          'Thanks for your review! You submitted a $_rating-star rating${comment.isNotEmpty ? ' with a comment.' : '.'}',
        ),
      ),
    );
  }

  Future<void> _showReceipt() async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.transparent,
      builder: (context) {
        return Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface,
            borderRadius: const BorderRadius.vertical(top: Radius.circular(24)),
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Blockchain Receipt', style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w800)),
              const SizedBox(height: 10),
              const Text('Transaction hash'),
              const SizedBox(height: 6),
              SelectableText('0x8ab9f2c7e9f5d41a3d0b7f4d2c0e91f9c7d48abca7712c4f2c1d8b7f9a1c0e55'),
              const SizedBox(height: 16),
              PrimaryButton(label: 'Close', onPressed: () => Navigator.of(context).pop()),
            ],
          ),
        );
      },
    );
  }

  @override
  Widget build(BuildContext context) {
    final delivered = widget.order.status == 'Delivered';

    return Scaffold(
      appBar: AppBar(
        title: const Text('Order Details'),
        leading: IconButton(onPressed: () => Navigator.of(context).pop(), icon: const Icon(Icons.arrow_back_rounded)),
        actions: [IconButton(onPressed: () {}, icon: const Icon(Icons.download_rounded))],
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 24),
        children: [
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(widget.order.orderId, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 8),
                Text(widget.order.route, style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                const SizedBox(height: 8),
                Text('Date: ${widget.order.date}', style: Theme.of(context).textTheme.bodyMedium),
                const SizedBox(height: 8),
                StatusBadge(
                  label: widget.order.status == 'Delivered' ? '✅ Delivered' : '❌ Cancelled',
                  color: delivered ? TruxifyColors.accentDark : TruxifyColors.error,
                  filled: true,
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          InfoCard(
            child: Row(
              children: [
                Container(
                  width: 54,
                  height: 54,
                  decoration: const BoxDecoration(color: TruxifyColors.accentLight, shape: BoxShape.circle),
                  child: const Icon(Icons.person_rounded, color: TruxifyColors.accentDark),
                ),
                const SizedBox(width: 14),
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(widget.order.driver, style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 4),
                      Text('⭐ 4.8', style: Theme.of(context).textTheme.bodyMedium?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                      const SizedBox(height: 4),
                      Text(widget.order.truckNumber, style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TruxifyColors.adaptiveSecondaryText(context))),
                    ],
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          Text('Timeline', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
          const SizedBox(height: 12),
          ...widget.order.timeline.map(
            (step) => Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: TimelineRow(step: step),
            ),
          ),
          const SizedBox(height: 4),
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Price breakdown', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
                const SizedBox(height: 12),
                ...mockOrderDetailPriceLines.map(
                  (line) => Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      children: [
                        Text(line.label, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: line.isTotal ? FontWeight.w800 : FontWeight.w500)),
                        const Spacer(),
                        Text(line.amount, style: Theme.of(context).textTheme.bodyMedium?.copyWith(fontWeight: line.isTotal ? FontWeight.w800 : FontWeight.w600)),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
          const SizedBox(height: 16),
          OutlinedButton(onPressed: _showReceipt, child: const Text('View Blockchain Receipt')),
          const SizedBox(height: 12),
          PrimaryButton(
            label: 'Rebook This Route',
            onPressed: () {
              final routeParts = widget.order.route.split(' → ');
              final pickup = routeParts.length == 2 ? routeParts.first : widget.order.route;
              final drop = routeParts.length == 2 ? routeParts.last : widget.order.route;

              TruxifyScope.of(context).openFindTrucks(
                draft: RouteDraft(
                  pickup: pickup,
                  drop: drop,
                  dateLabel: widget.order.date,
                  goodsType: 'Textile',
                  weightTonnes: '3',
                  dimensions: '12 × 6 × 6',
                  stacked: true,
                  fragile: false,
                  requirements: const ['Loading help needed'],
                ),
              );
            },
          ),
          const SizedBox(height: 18),
          if (widget.order.status == 'Delivered') ...[
            Text('Rate your driver', style: Theme.of(context).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w800)),
            const SizedBox(height: 10),
            Row(
              children: List.generate(5, (index) {
                final selected = index < _rating;
                return IconButton(
                  onPressed: () => setState(() => _rating = index + 1),
                  icon: Icon(selected ? Icons.star_rounded : Icons.star_border_rounded, color: Colors.amber, size: 30),
                );
              }),
            ),
            const SizedBox(height: 8),
            TextField(controller: _commentController, maxLines: 3, decoration: const InputDecoration(labelText: 'Comment')),
            const SizedBox(height: 12),
            PrimaryButton(label: 'Submit Rating', onPressed: _submitRating),
          ],
        ],
      ),
    );
  }
}

