import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';
import 'supabase_service.dart';

class OrderService {
  OrderService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final ApiClient _apiClient;

  Map<String, String> _customHeaders() {
    final userId = SupabaseService.requireUserId();
    return <String, String>{
      'x-user-id': userId,
      'x-user-role': 'customer',
    };
  }

  Future<String> createOrder({
    required String pickupAddress,
    required String dropAddress,
    required double pickupLat,
    required double pickupLng,
    required double dropLat,
    required double dropLng,
    required String pickupTime,
    required String goodsType,
    required double weightTonnes,
    String? paymentMethodId,
    String? upiId,
  }) async {
    final user = SupabaseService.currentUser;
    final fullName = user?.userMetadata?['full_name']?.toString();
    final headers = _customHeaders();
    if (fullName != null && fullName.isNotEmpty) {
      headers['x-user-name'] = fullName;
    }

    try {
      final body = await _apiClient.post(
        '/api/orders',
        headers: headers,
        body: <String, dynamic>{
          'pickup_address': pickupAddress,
          'pickup_lat': pickupLat,
          'pickup_lng': pickupLng,
          'drop_address': dropAddress,
          'drop_lat': dropLat,
          'drop_lng': dropLng,
          'pickup_date': DateTime.now().toIso8601String(),
          'pickup_time': pickupTime,
          'goods_type': goodsType,
          'weight_tonnes': weightTonnes,
          'payment_method_id': paymentMethodId,
          'upi_id': upiId,
        },
      ) as Map<String, dynamic>?;

      return body?['order']?['order_display_id']?.toString() ?? '';
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to create order via backend API: $e');
    }
  }

  Future<Map<String, dynamic>> changeDrop({
    required String orderDisplayId,
    required String dropAddress,
    required double dropLat,
    required double dropLng,
  }) async {
    try {
      final body = await _apiClient.put(
        '/api/orders/$orderDisplayId/change-drop',
        headers: _customHeaders(),
        body: <String, dynamic>{
          'drop_address': dropAddress,
          'drop_lat': dropLat,
          'drop_lng': dropLng,
        },
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to change drop via backend API: $e');
    }
  }

  Future<Map<String, dynamic>> cancelOrder({
    required String orderDisplayId,
    String? reason,
  }) async {
    try {
      final body = await _apiClient.post(
        '/api/orders/$orderDisplayId/cancel',
        headers: _customHeaders(),
        body: <String, dynamic>{
          if (reason != null) 'reason': reason,
        },
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to cancel order via backend API: $e');
    }
  }

  Future<Map<String, dynamic>?> fetchOrderById(String orderDisplayId) async {
    try {
      final body = await _apiClient.get(
        '/api/orders/$orderDisplayId',
        headers: _customHeaders(),
      ) as Map<String, dynamic>?;
      return body?['order'] as Map<String, dynamic>?;
    } on ApiException catch (e) {
      if (e.statusCode == 404) return null;
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch order: $e');
    }
  }

  Future<List<Map<String, dynamic>>> fetchOrders() async {
    try {
      final body = await _apiClient.get(
        '/api/orders/history',
        headers: _customHeaders(),
      );
      return List<Map<String, dynamic>>.from(body as List);
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch orders: $e');
    }
  }

  Future<List<Map<String, dynamic>>> fetchOrderTimeline(
    String orderDisplayId,
  ) async {
    try {
      final body = await _apiClient.get(
        '/api/orders/$orderDisplayId/timeline',
        headers: _customHeaders(),
      );
      return List<Map<String, dynamic>>.from(body as List);
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch order timeline: $e');
    }
  }

  Future<List<Map<String, dynamic>>> fetchActiveOrders() async {
    try {
      final body = await _apiClient.get(
        '/api/orders/my/active',
        headers: _customHeaders(),
      );
      return List<Map<String, dynamic>>.from(body as List);
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch active orders: $e');
    }
  }

  Future<List<Map<String, dynamic>>> searchTrucks({
    required double pickupLat,
    required double pickupLng,
    required double dropLat,
    required double dropLng,
    required double weightTonnes,
    bool isFragile = false,
    bool isStackable = true,
  }) async {
    final params = <String, String>{
      'pickup_lat': pickupLat.toString(),
      'pickup_lng': pickupLng.toString(),
      'drop_lat': dropLat.toString(),
      'drop_lng': dropLng.toString(),
      'weight_tonnes': weightTonnes.toString(),
      'is_fragile': isFragile.toString(),
      'is_stackable': isStackable.toString(),
    };

    final path = Uri(path: '/api/trucks/search', queryParameters: params).toString();

    try {
      final body = await _apiClient.get(
        path,
        headers: _customHeaders(),
      );
      final List<dynamic> listBody = body is List<dynamic> ? body : <dynamic>[];
      return listBody.cast<Map<String, dynamic>>();
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to search trucks: $e');
    }
  }

  /// Estimates the price range for a shipment.
  /// Returns a map with estimated total price in paise.
  /// Returns null if estimation fails or parameters are invalid.
  Future<Map<String, dynamic>?> estimatePriceRange({
    required double pickupLat,
    required double pickupLng,
    required double dropLat,
    required double dropLng,
    required double weightTonnes,
    bool isFragile = false,
    bool isStackable = true,
  }) async {
    try {
      final results = await searchTrucks(
        pickupLat: pickupLat,
        pickupLng: pickupLng,
        dropLat: dropLat,
        dropLng: dropLng,
        weightTonnes: weightTonnes,
        isFragile: isFragile,
        isStackable: isStackable,
      );

      if (results.isEmpty) return null;

      // Extract price values from results and calculate min/max
      final prices = results
          .map((r) => r['price'] as num?)
          .whereType<num>()
          .map((p) => p.round())
          .toList();

      if (prices.isEmpty) return null;

      prices.sort();
      final minPrice = prices.first;
      final maxPrice = prices.last;

      return {
        'minPrice': minPrice,
        'maxPrice': maxPrice,
      };
    } on StateError {
      return null;
    } catch (e) {
      debugPrint('Failed to estimate price: $e');
      return null;
    }
  }

  Future<List<Map<String, dynamic>>> fetchHistoryOrders() async {
    try {
      final body = await _apiClient.get(
        '/api/orders/history',
        headers: _customHeaders(),
      );
      return List<Map<String, dynamic>>.from(body as List);
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch history orders: $e');
    }
  }

  Future<String?> fetchDriverName(String driverId) async {
    try {
      final body = await _apiClient.get(
        '/api/profile/$driverId/name',
        headers: _customHeaders(),
      ) as Map<String, dynamic>?;
      final fullName = body?['full_name']?.toString().trim();
      return (fullName != null && fullName.isNotEmpty) ? fullName : null;
    } catch (e, st) {
      debugPrint('Error fetching driver name: $e\n$st');
      return null;
    }
  }

  Future<String?> fetchTruckNumber(String truckId) async {
    try {
      final body = await _apiClient.get(
        '/api/trucks/$truckId/number',
        headers: _customHeaders(),
      ) as Map<String, dynamic>?;
      final numberPlate = body?['number_plate']?.toString().trim();
      return (numberPlate != null && numberPlate.isNotEmpty) ? numberPlate : null;
    } catch (e, st) {
      debugPrint('Error fetching truck number: $e\n$st');
      return null;
    }
  }

  Future<Map<String, dynamic>> fetchDriverLocation(String orderDisplayId) async {
    try {
      final body = await _apiClient.get(
        '/api/orders/$orderDisplayId/driver-location',
        headers: _customHeaders(),
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch driver location: $e');
    }
  }

  Future<Map<String, dynamic>> fetchOrderRoute(String orderDisplayId) async {
    try {
      final body = await _apiClient.get(
        '/api/orders/$orderDisplayId/route',
        headers: _customHeaders(),
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch order route: $e');
    }
  }
}