import '../models/truck_profile_model.dart';

class CommercialNavigationService {
  /// Calculates a commercial route that factors in truck dimensions and hazmat
  /// status.
  Future<NavigationRoute> calculateSafeRoute(String origin, String destination, TruckProfile profile) async {
    throw UnsupportedError(
      'Commercial navigation is not configured. Connect a truck-routing provider before displaying safe-route guidance.',
    );
  }
}
