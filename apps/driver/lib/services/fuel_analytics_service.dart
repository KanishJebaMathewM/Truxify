import 'trip_service.dart';

class FuelAnalyticsService {
  final TripService _tripService = TripService();

  Future<Map<String, dynamic>> calculateAnalytics(double averageMpg) async {
    try {
      // Fetch all completed trips for this driver
      final trips = await _tripService.fetchTrips(status: 'delivered');
      
      double totalDistanceKm = 0;
      double totalPayout = 0;

      for (var trip in trips) {
        final rawDistance = trip['distance']?.toString() ?? '0';
        final rawEarnings = trip['earnings']?.toString() ?? '0';
        
        final numericDistance = double.tryParse(rawDistance.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 0.0;
        final numericEarnings = double.tryParse(rawEarnings.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 0.0;
        
        totalDistanceKm += numericDistance;
        totalPayout += numericEarnings;
      }

      // Convert KM to Miles (1 km = 0.621371 miles)
      final totalDistanceMiles = totalDistanceKm * 0.621371;

      // Fuel cost calculation (assume constant fuel price for demo e.g. $4.00 per gallon)
      const fuelPricePerGallon = 4.0;
      final fuelGallonsUsed = averageMpg > 0 ? (totalDistanceMiles / averageMpg) : 0;
      final estimatedFuelCost = fuelGallonsUsed * fuelPricePerGallon;
      
      final profitMargin = totalPayout > 0 
          ? ((totalPayout - estimatedFuelCost) / totalPayout) * 100 
          : 0.0;

      // Provide sample points for a chart (last 5 trips)
      final chartPoints = <Map<String, dynamic>>[];
      for (int i = 0; i < trips.length && i < 5; i++) {
        final t = trips[i];
        final numDist = double.tryParse(t['distance']?.toString().replaceAll(RegExp(r'[^0-9.]'), '') ?? '0') ?? 0;
        final numEarn = double.tryParse(t['earnings']?.toString().replaceAll(RegExp(r'[^0-9.]'), '') ?? '0') ?? 0;
        final miles = numDist * 0.621371;
        final fCost = averageMpg > 0 ? (miles / averageMpg) * fuelPricePerGallon : 0;
        
        chartPoints.add({
          'label': t['date'] ?? 'Trip',
          'payout': numEarn,
          'fuelCost': fCost,
        });
      }

      return {
        'totalPayout': totalPayout,
        'estimatedFuelCost': estimatedFuelCost,
        'profitMargin': profitMargin,
        'chartPoints': chartPoints.reversed.toList(),
      };
    } catch (e) {
      throw Exception('Failed to calculate fuel analytics: $e');
    }
  }
}
