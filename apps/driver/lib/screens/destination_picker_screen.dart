import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:http/http.dart' as http;
import 'package:latlong2/latlong.dart' as ll;

import '../services/geocode_service.dart';
import '../theme/app_theme.dart';
import '../widgets/common_widgets.dart';

class DestinationPickResult {
  const DestinationPickResult({required this.address, required this.point});

  final String address;
  final ll.LatLng point;
}

class DestinationPickerArgs {
  const DestinationPickerArgs({
    required this.title,
    this.initialQuery,
    this.initialPoint,
  });

  final String title;
  final String? initialQuery;
  final ll.LatLng? initialPoint;
}

class DestinationPickerScreen extends StatefulWidget {
  const DestinationPickerScreen({
    super.key,
    required this.title,
    this.initialQuery,
    this.initialPoint,
    this.client,
  });

  final String title;
  final String? initialQuery;
  final ll.LatLng? initialPoint;
  final http.Client? client;

  @override
  State<DestinationPickerScreen> createState() => _DestinationPickerScreenState();
}

class _DestinationPickerScreenState extends State<DestinationPickerScreen> {
  static const ll.LatLng _defaultCenter = ll.LatLng(22.9734, 78.6569);

  final MapController _mapController = MapController();
  final TextEditingController _searchController = TextEditingController();
  final double _mapZoom = 5.2;
  late final http.Client _httpClient;

  Timer? _debounce;
  List<SearchResult> _suggestions = const <SearchResult>[];
  bool _isSearching = false;
  bool _isResolvingAddress = false;
  ll.LatLng? _selectedPoint;
  String? _selectedAddress;

  @override
  void initState() {
    super.initState();
    _httpClient = widget.client ?? http.Client();
    _searchController.text = widget.initialQuery ?? '';
    _selectedPoint = widget.initialPoint;
    if (_selectedPoint != null) {
      _resolveAddress(_selectedPoint!);
    }
  }

  @override
  void dispose() {
    _mapController.dispose();
    _debounce?.cancel();
    _searchController.dispose();
    if (widget.client == null) _httpClient.close();
    super.dispose();
  }

  Future<void> _searchPlaces(String query) async {
    final trimmed = query.trim();
    if (trimmed.length < 3) {
      if (mounted) {
        setState(() {
          _suggestions = const <SearchResult>[];
          _isSearching = false;
        });
      }
      return;
    }

    setState(() {
      _isSearching = true;
    });

    try {
      final results = await GeocodeService.searchPlaces(
        trimmed,
        client: _httpClient,
      );

      if (!mounted) {
        return;
      }

      setState(() {
        _suggestions = results;
      });
    } catch (e) {
      if (!mounted) {
        return;
      }

      setState(() {
        _suggestions = const <SearchResult>[];
      });
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(content: Text('Search error: $e')),
      );
    } finally {
      if (mounted) {
        setState(() {
          _isSearching = false;
        });
      }
    }
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 350), () {
      _searchPlaces(value);
    });
  }

  Future<void> _resolveAddress(ll.LatLng point) async {
    setState(() {
      _isResolvingAddress = true;
    });

    try {
      final displayName = await GeocodeService.reverseGeocode(point);

      if (!mounted) {
        return;
      }

      setState(() {
        _selectedAddress =
            (displayName == null || displayName.trim().isEmpty)
                ? 'Pinned location (${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)})'
                : displayName;
      });
    } catch (_) {
      if (!mounted) {
        return;
      }

      setState(() {
        _selectedAddress =
            'Pinned location (${point.latitude.toStringAsFixed(5)}, ${point.longitude.toStringAsFixed(5)})';
      });
    } finally {
      if (mounted) {
        setState(() {
          _isResolvingAddress = false;
        });
      }
    }
  }

  Future<void> _setLocation(ll.LatLng point, {String? address}) async {
    setState(() {
      _selectedPoint = point;
      _selectedAddress = address;
      _suggestions = const <SearchResult>[];
    });

    _mapController.move(point, 13);

    if (address == null || address.trim().isEmpty) {
      await _resolveAddress(point);
      return;
    }

    _searchController.text = address;
  }

  @override
  Widget build(BuildContext context) {
    final center = _selectedPoint ?? _defaultCenter;

    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
            child: TextField(
              controller: _searchController,
              onChanged: _onSearchChanged,
              decoration: InputDecoration(
                hintText: 'Search area, landmark, or city',
                prefixIcon: const Icon(Icons.search_rounded),
                suffixIcon: _isSearching
                    ? const Padding(
                        padding: EdgeInsets.all(12),
                        child: SizedBox(
                          width: 16,
                          height: 16,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      )
                    : null,
              ),
            ),
          ),
          if (_suggestions.isNotEmpty)
            Container(
              margin: const EdgeInsets.symmetric(horizontal: 16),
              decoration: BoxDecoration(
                color: Theme.of(context).colorScheme.surface,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: TruxifyColors.border),
              ),
              constraints: const BoxConstraints(maxHeight: 200),
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: _suggestions.length,
                separatorBuilder: (_, __) => const Divider(height: 1),
                itemBuilder: (context, index) {
                  final suggestion = _suggestions[index];
                  return Material(
                    color: Colors.transparent,
                    child: ListTile(
                      dense: true,
                      leading: const Icon(
                        Icons.place_rounded,
                        color: TruxifyColors.accentDark,
                      ),
                      title: Text(
                        suggestion.address,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                      ),
                      onTap: () => _setLocation(
                        suggestion.point,
                        address: suggestion.address,
                      ),
                    ),
                  );
                },
              ),
            ),
          const SizedBox(height: 8),
          Expanded(
            child: Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: ClipRRect(
                borderRadius: BorderRadius.circular(16),
                 child: FlutterMap(
                   mapController: _mapController,
                   options: MapOptions(
                     initialCenter: center,
                     initialZoom: _selectedPoint == null ? _mapZoom : 12.5,
                     minZoom: 4,
                     maxZoom: 18,
                     onTap: (_, point) => _setLocation(point),
                   ),
                  children: [
                    TileLayer(
                      urlTemplate:
                          'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                      userAgentPackageName: 'com.truxify.driver',
                    ),
                    if (_selectedPoint != null)
                      MarkerLayer(
                        markers: [
                          Marker(
                            point: _selectedPoint!,
                            width: 44,
                            height: 44,
                            alignment: Alignment.topCenter,
                            child: const Icon(
                              Icons.location_on_rounded,
                              color: TruxifyColors.error,
                              size: 38,
                            ),
                          ),
                        ],
                      ),
                  ],
                ),
              ),
            ),
          ),
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
            child: AppCard(
              padding: const EdgeInsets.all(14),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Selected Destination',
                    style: Theme.of(context).textTheme.labelMedium?.copyWith(
                          color: TruxifyColors.adaptiveSecondaryText(context),
                          fontWeight: FontWeight.w700,
                        ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    _selectedAddress ?? 'Tap on map or search to set a destination',
                    style: Theme.of(context).textTheme.bodyMedium,
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (_isResolvingAddress)
                    const Padding(
                      padding: EdgeInsets.only(top: 8),
                      child: LinearProgressIndicator(minHeight: 2),
                    ),
                  const SizedBox(height: 12),
                  PrimaryButton(
                    label: 'Confirm Destination',
                    onPressed: _selectedPoint == null || _selectedAddress == null
                        ? null
                        : () {
                            Navigator.of(context).pop(
                              DestinationPickResult(
                                address: _selectedAddress!,
                                point: _selectedPoint!,
                              ),
                            );
                          },
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

