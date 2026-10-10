import 'package:flutter/material.dart';

class EmptyTruckResultsWidget extends StatelessWidget {
  final VoidCallback? onResetFilters;
  final VoidCallback? onNotifyPressed;

  const EmptyTruckResultsWidget({
    Key? key,
    this.onResetFilters,
    this.onNotifyPressed,
  }) : super(key: key);

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 24.0, vertical: 36.0),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            // Illustration / Icon placeholder
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: Colors.blue.withOpacity(0.08),
                shape: BoxShape.circle,
              ),
              child: const Icon(
                Icons.local_shipping_outlined,
                size: 64,
                color: Colors.blueAccent,
              ),
            ),
            const SizedBox(height: 24),
            
            // Title message
            const Text(
              'No Trucks Found',
              style: TextStyle(
                fontSize: 20,
                fontWeight: FontWeight.bold,
                color: Colors.black87,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 8),

            // Description message
            const Text(
              'No trucks match your selected route, date, or cargo capacity. Try adjusting your search filters or dates.',
              style: TextStyle(
                fontSize: 14,
                color: Colors.black54,
                height: 1.4,
              ),
              textAlign: TextAlign.center,
            ),
            const SizedBox(height: 32),

            // Action Buttons
            if (onResetFilters != null)
              ElevatedButton.icon(
                onPressed: onResetFilters,
                icon: const Icon(Icons.refresh),
                label: const Text('Reset Filters'),
                style: ElevatedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            
            if (onNotifyPressed != null) ...[
              const SizedBox(height: 12),
              OutlinedButton.icon(
                onPressed: onNotifyPressed,
                icon: const Icon(Icons.notifications_active_outlined),
                label: const Text('Notify me when available'),
                style: OutlinedButton.styleFrom(
                  minimumSize: const Size.fromHeight(48),
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10),
                  ),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
