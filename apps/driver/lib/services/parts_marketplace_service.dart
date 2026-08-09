import 'dart:async';
import '../models/workshop_inventory_model.dart';

class PartsMarketplaceService {
  /// Simulates querying a national heavy-duty parts network API
  /// to find repair shops near the breakdown location that have a specific part in stock.
  Future<List<WorkshopInventory>> locatePartAndWorkshop({
    required String faultCode,
    required String partRequired,
    required double currentLat,
    required double currentLng,
  }) async {
    // Simulate API query latency
    await Future.delayed(const Duration(seconds: 2));

    final now = DateTime.now();

    return [
      WorkshopInventory(
        workshopId: 'WS-TA-990',
        workshopName: 'TA Truck Service (I-80 Exit 42)',
        address: '100 Highway Rd, Springfield',
        distanceMiles: 4.2,
        hasPartInStock: true,
        estimatedPartCost: 450.00,
        availableBays: 1,
        nextAvailableSlot: now.add(const Duration(minutes: 45)),
      ),
      WorkshopInventory(
        workshopId: 'WS-LOVE-112',
        workshopName: 'Love\'s Heavy Duty Repair',
        address: '250 Interstate Blvd, Springfield',
        distanceMiles: 8.5,
        hasPartInStock: false, // Out of stock
        estimatedPartCost: 0.00,
        availableBays: 3,
        nextAvailableSlot: now,
      ),
      WorkshopInventory(
        workshopId: 'WS-IND-55',
        workshopName: 'Bob\'s Diesel Mechanics',
        address: '88 Industrial Pkwy, Springfield',
        distanceMiles: 12.0,
        hasPartInStock: true,
        estimatedPartCost: 410.00,
        availableBays: 0,
        nextAvailableSlot: now.add(const Duration(hours: 4)), // Long wait
      ),
    ];
  }
}
