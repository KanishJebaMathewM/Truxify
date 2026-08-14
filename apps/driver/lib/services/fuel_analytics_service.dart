import 'trip_service.dart';

class FuelAnalyticsService {
  final TripService _tripService = TripService();

  Future<Map<String, dynamic>> calculateAnalytics(double averageMpg) async {
    try {
      // Fetch all completed trips for this driver
      final trips = await _tripService.fetchTrips(status: 'completed');
      
      double totalDistanceKm = 0;
      double totalPayout = 0;

      for (var trip in trips) {
        final rawDistance = trip['distance']?.toString() ?? '0';
        final rawEarnings = trip['earnings']?.toString() ?? '0';
        
        final numericDistance = double.tryParse(rawDistance.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 0.0;
        final numericEarnings = double.tryParse(rawEarnings.replaceAll(RegExp(r'[^0-9.]'), '')) ?? 0.0;
        
        totalDistanceKm += numericDistance;
        totalPayout += numericEarnings / 100; // earnings are in paisa
      }

      // Fuel cost calculation (assume ₹ per litre, km/litre efficiency)
      const fuelPricePerLitre = 90.0;
      final kmPerLitre = averageMpg > 0 ? averageMpg * 1.60934 / 3.78541 : 0;
      final fuelLitresUsed = kmPerLitre > 0 ? (totalDistanceKm / kmPerLitre) : 0;
      final estimatedFuelCost = fuelLitresUsed * fuelPricePerLitre;
      
      final profitMargin = totalPayout > 0 
          ? ((totalPayout - estimatedFuelCost) / totalPayout) * 100 
          : 0.0;

      // Provide sample points for a chart (last 5 trips)
      final chartPoints = <Map<String, dynamic>>[];
      final startIndex = trips.length > 5 ? trips.length - 5 : 0;
      for (int i = startIndex; i < trips.length; i++) {
        final t = trips[i];
        final numDist = double.tryParse(t['distance']?.toString().replaceAll(RegExp(r'[^0-9.]'), '') ?? '0') ?? 0;
        final numEarn = double.tryParse(t['earnings']?.toString().replaceAll(RegExp(r'[^0-9.]'), '') ?? '0') ?? 0;
        final litresUsed = kmPerLitre > 0 ? (numDist / kmPerLitre) : 0;
        final fCost = litresUsed * fuelPricePerLitre;
        
        chartPoints.add({
          'label': t['date'] ?? 'Trip',
          'payout': numEarn / 100,
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
