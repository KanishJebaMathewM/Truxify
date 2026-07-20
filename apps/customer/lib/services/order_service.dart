import 'dart:convert';
import 'package:flutter/material.dart';
import '../core/api_client.dart';

class OrderService {
  OrderService({
    ApiClient? apiClient,
  }) : _apiClient = apiClient ?? ApiClient();

  final ApiClient _apiClient;

  String _encodePathSegment(String value) => Uri.encodeComponent(value);

  List<Map<String, dynamic>> _mapList(dynamic value, String label) {
    if (value is! List) {
      throw StateError('Unexpected $label response type');
    }

    return value.map((item) {
      if (item is Map<String, dynamic>) {
        return item;
      }
      if (item is Map) {
        return Map<String, dynamic>.from(item);
      }
      throw StateError('Unexpected $label item type');
    }).toList(growable: false);
  }

  List<Map<String, dynamic>> _timelineFromResponse(dynamic body) {
    if (body is Map<String, dynamic>) {
      return _mapList(body['timeline'], 'order timeline');
    }
    return _mapList(body, 'order timeline');
  }

  List<Map<String, dynamic>> _historyFromResponse(dynamic body) {
    if (body is Map<String, dynamic>) {
      final history = body['history'];
      return history == null
          ? <Map<String, dynamic>>[]
          : _mapList(history, 'order history');
    }
    return _mapList(body, 'order history');
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
    DateTime? pickupDate,
  }) async {
    try {
      final body = await _apiClient.post(
        '/api/orders',
        body: <String, dynamic>{
          'pickup_address': pickupAddress,
          'pickup_lat': pickupLat,
          'pickup_lng': pickupLng,
          'drop_address': dropAddress,
          'drop_lat': dropLat,
          'drop_lng': dropLng,
          'pickup_date': (pickupDate ?? DateTime.now()).toIso8601String(),
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
        '/api/orders/${_encodePathSegment(orderDisplayId)}/change-drop',
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
        '/api/orders/${_encodePathSegment(orderDisplayId)}/cancel',
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
        '/api/orders/${_encodePathSegment(orderDisplayId)}',
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
      );
      return _historyFromResponse(body);
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
        '/api/orders/${_encodePathSegment(orderDisplayId)}/timeline',
      );
      return _timelineFromResponse(body);
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
      );
      if (body is! List) {
        throw StateError('Unexpected active orders response type');
      }
      return body.map((item) {
        if (item is Map<String, dynamic>) return item;
        if (item is Map) return Map<String, dynamic>.from(item);
        throw StateError('Unexpected active order item type');
      }).toList(growable: false);
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
    String? truckType,
    double? minCapacity,
    double? maxCapacity,
    String? materialType,
  }) async {
    final params = <String, String>{
      'pickup_lat': pickupLat.toString(),
      'pickup_lng': pickupLng.toString(),
      'drop_lat': dropLat.toString(),
      'drop_lng': dropLng.toString(),
      'weight_tonnes': weightTonnes.toString(),
      'is_fragile': isFragile.toString(),
      'is_stackable': isStackable.toString(),
      if (truckType != null) 'truck_type': truckType,
      if (minCapacity != null) 'min_capacity': minCapacity.toString(),
      if (maxCapacity != null) 'max_capacity': maxCapacity.toString(),
      if (materialType != null) 'material_type': materialType,
    };

    final path = Uri(path: '/api/trucks/search', queryParameters: params).toString();

    try {
      final body = await _apiClient.get(
        path,
      );
      if (body is! List) {
        throw StateError('Unexpected truck search response type');
      }
      final listBody = body;
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
      );
      return _historyFromResponse(body);
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch history orders: $e');
    }
  }

  Future<String?> fetchDriverName(String driverId) async {
    try {
      final body = await _apiClient.get(
        '/api/profile/${_encodePathSegment(driverId)}/name',
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
        '/api/trucks/${_encodePathSegment(truckId)}/number',
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
        '/api/orders/${_encodePathSegment(orderDisplayId)}/driver-location',
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch driver location: $e');
    }
  }

  /// Submits a star rating (and optional comment) for a delivered order.
  ///
  /// Calls `POST /api/orders/:id/ratings` with `{ stars, comment }`.
  /// Returns the rating payload from the server on success.
  /// Throws [StateError] on API or network failure.
  Future<Map<String, dynamic>> submitRating({
    required String orderId,
    required int stars,
    String? comment,
  }) async {
    try {
      final body = await _apiClient.post(
        '/api/orders/${_encodePathSegment(orderId)}/ratings',
        body: <String, dynamic>{
          'stars': stars,
          if (comment != null && comment.isNotEmpty) 'comment': comment,
        },
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to submit rating: $e');
    }
  }

  Future<Map<String, dynamic>> fetchOrderRoute(String orderDisplayId) async {
    try {
      final body = await _apiClient.get(
        '/api/orders/${_encodePathSegment(orderDisplayId)}/route',
      );
      return body is Map<String, dynamic> ? body : <String, dynamic>{};
    } on ApiException catch (e) {
      throw StateError(e.message);
    } catch (e) {
      throw StateError('Failed to fetch order route: $e');
    }
  }
}
