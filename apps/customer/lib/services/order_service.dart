import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import 'package:supabase_flutter/supabase_flutter.dart';
import 'supabase_service.dart';

class OrderService {
  OrderService({
    SupabaseClient? client,
    http.Client? httpClient,
    String? apiBaseUrl,
  })  : _providedClient = client,
        _httpClient = httpClient ?? http.Client(),
        _apiBaseUrl = _normalizeBaseUrl(apiBaseUrl ?? defaultApiBaseUrl);

  static const String defaultApiBaseUrl = String.fromEnvironment(
    'TRUXIFY_API_BASE_URL',
    defaultValue: 'http://localhost:5000',
  );

  final SupabaseClient? _providedClient;
  final http.Client _httpClient;
  final String _apiBaseUrl;

  SupabaseClient get _client => _providedClient ?? Supabase.instance.client;

  static String _normalizeBaseUrl(String value) {
    return value.endsWith('/') ? value.substring(0, value.length - 1) : value;
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
    final userId = SupabaseService.requireUserId();
    final token = _client.auth.currentSession?.accessToken;
    final fullName = user?.userMetadata?['full_name']?.toString();

    final response = await _httpClient.post(
      Uri.parse('$_apiBaseUrl/api/orders'),
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
        if (fullName != null && fullName.isNotEmpty) 'x-user-name': fullName,
      },
      body: jsonEncode(<String, dynamic>{
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
      }),
    );

    final body = response.body.isNotEmpty
        ? jsonDecode(response.body) as Map<String, dynamic>
        : <String, dynamic>{};

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(
        body['error']?.toString() ?? 'Failed to create order via backend API.',
      );
    }

    return body['order']?['order_display_id']?.toString() ?? '';
  }

  Future<Map<String, dynamic>> changeDrop({
    required String orderDisplayId,
    required String dropAddress,
    required double dropLat,
    required double dropLng,
  }) async {
    final token = _client.auth.currentSession?.accessToken;
    final userId = SupabaseService.requireUserId();

    final uri = Uri.parse('$_apiBaseUrl/api/orders/$orderDisplayId/change-drop');

    final response = await _httpClient.put(
      uri,
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
      },
      body: jsonEncode(<String, dynamic>{
        'drop_address': dropAddress,
        'drop_lat': dropLat,
        'drop_lng': dropLng,
      }),
    );

    final body = response.body.isNotEmpty ? jsonDecode(response.body) as Map<String, dynamic> : <String, dynamic>{};

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(body['error']?.toString() ?? 'Failed to change drop via backend API.');
    }

    return body;
  }

  Future<Map<String, dynamic>> cancelOrder({
    required String orderDisplayId,
    String? reason,
  }) async {
    final token = _client.auth.currentSession?.accessToken;
    final userId = SupabaseService.requireUserId();

    final uri = Uri.parse('$_apiBaseUrl/api/orders/$orderDisplayId/cancel');

    final response = await _httpClient.post(
      uri,
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
      },
      body: jsonEncode(<String, dynamic>{
        if (reason != null) 'reason': reason,
      }),
    );

    final body = response.body.isNotEmpty ? jsonDecode(response.body) as Map<String, dynamic> : <String, dynamic>{};

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError(body['error']?.toString() ?? 'Failed to cancel order via backend API.');
    }

    return body;
  }

  Map<String, String> _authHeaders() {
    final token = _client.auth.currentSession?.accessToken;
    final userId = SupabaseService.requireUserId();
    return <String, String>{
      'Content-Type': 'application/json',
      if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
      'x-user-id': userId,
      'x-user-role': 'customer',
    };
  }

  Future<Map<String, dynamic>?> fetchOrderById(String orderDisplayId) async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/$orderDisplayId');
    final response = await _httpClient.get(uri, headers: _authHeaders());

    if (response.statusCode == 404) return null;
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch order');
    }

    final body = jsonDecode(response.body) as Map<String, dynamic>;
    return body['order'] as Map<String, dynamic>?;
  }

  Future<List<Map<String, dynamic>>> fetchOrders() async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/history');
    final response = await _httpClient.get(uri, headers: _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch orders');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<List<Map<String, dynamic>>> fetchOrderTimeline(
    String orderDisplayId,
  ) async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/$orderDisplayId/timeline');
    final response = await _httpClient.get(uri, headers: _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch order timeline');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<List<Map<String, dynamic>>> fetchActiveOrders() async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/my/active');
    final response = await _httpClient.get(uri, headers: _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch active orders');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
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
    final token = _client.auth.currentSession?.accessToken;
    final userId = SupabaseService.requireUserId();

    final params = <String, String>{
      'pickup_lat': pickupLat.toString(),
      'pickup_lng': pickupLng.toString(),
      'drop_lat': dropLat.toString(),
      'drop_lng': dropLng.toString(),
      'weight_tonnes': weightTonnes.toString(),
      'is_fragile': isFragile.toString(),
      'is_stackable': isStackable.toString(),
    };

    final uri = Uri.parse('$_apiBaseUrl/api/trucks/search').replace(queryParameters: params);
    final response = await _httpClient.get(
      uri,
      headers: <String, String>{
        'Content-Type': 'application/json',
        if (token != null && token.isNotEmpty) 'Authorization': 'Bearer $token',
        'x-user-id': userId,
        'x-user-role': 'customer',
      },
    );

    final body = response.body.isNotEmpty
        ? jsonDecode(response.body)
        : null;

    if (response.statusCode < 200 || response.statusCode >= 300) {
      final message = body is Map<String, dynamic>
          ? (body['error']?.toString() ?? 'Failed to search trucks')
          : 'Failed to search trucks';
      throw StateError(message);
    }

    final List<dynamic> listBody = body is List<dynamic> ? body : <dynamic>[];

    return listBody.cast<Map<String, dynamic>>();
  }

  Future<List<Map<String, dynamic>>> fetchHistoryOrders() async {
    final uri = Uri.parse('$_apiBaseUrl/api/orders/history');
    final response = await _httpClient.get(uri, headers: _authHeaders());

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw StateError('Failed to fetch history orders');
    }

    final body = jsonDecode(response.body);
    return List<Map<String, dynamic>>.from(body as List);
  }

  Future<String?> fetchDriverName(String driverId) async {
    try {
      final uri = Uri.parse('$_apiBaseUrl/api/profile/$driverId/name');
      final response = await _httpClient.get(uri, headers: _authHeaders());
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        final fullName = body['full_name']?.toString().trim();
        return (fullName != null && fullName.isNotEmpty) ? fullName : null;
      }
      return null;
    } catch (e, st) {
      debugPrint('Error fetching driver name: $e\n$st');
      return null;
    }
  }

  Future<String?> fetchTruckNumber(String truckId) async {
    try {
      final uri = Uri.parse('$_apiBaseUrl/api/trucks/$truckId/number');
      final response = await _httpClient.get(uri, headers: _authHeaders());
      if (response.statusCode == 200) {
        final body = jsonDecode(response.body) as Map<String, dynamic>;
        final numberPlate = body['number_plate']?.toString().trim();
        return (numberPlate != null && numberPlate.isNotEmpty) ? numberPlate : null;
      }
      return null;
    } catch (e, st) {
      debugPrint('Error fetching truck number: $e\n$st');
      return null;
    }
  }
}
