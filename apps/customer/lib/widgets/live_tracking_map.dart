import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';

class LiveTrackingMap extends StatefulWidget {
  final LatLng initialPosition;

  const LiveTrackingMap({
    super.key,
    this.initialPosition = const LatLng(19.0760, 72.8777), // Default: Mumbai
  });

  @override
  State<LiveTrackingMap> createState() => _LiveTrackingMapState();
}

class _LiveTrackingMapState extends State<LiveTrackingMap> {
  late LatLng _currentPosition;
  Timer? _timer;
  late final MapController _mapController;

  @override
  void initState() {
    super.initState();
    _currentPosition = widget.initialPosition;
    _mapController = MapController();
    
    // Mocking live tracking updates every 3 seconds
    _timer = Timer.periodic(const Duration(seconds: 3), (timer) {
      if (mounted) {
        setState(() {
          // Simulate movement by adding a small random delta
          _currentPosition = LatLng(
            _currentPosition.latitude + 0.0002,
            _currentPosition.longitude + 0.0002,
          );
        });
        
        // Optionally keep the truck centered if it moves too far
        _mapController.move(_currentPosition, _mapController.camera.zoom);
      }
    });
  }

  @override
  void dispose() {
    _timer?.cancel();
    _mapController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return FlutterMap(
      mapController: _mapController,
      options: MapOptions(
        initialCenter: widget.initialPosition,
        initialZoom: 14.0,
        interactionOptions: const InteractionOptions(
          flags: InteractiveFlag.all & ~InteractiveFlag.rotate,
        ),
      ),
      children: [
        TileLayer(
          urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
          userAgentPackageName: 'com.truxify.customer',
        ),
        MarkerLayer(
          markers: [
            Marker(
              point: _currentPosition,
              width: 50.0,
              height: 50.0,
              child: Stack(
                alignment: Alignment.center,
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      shape: BoxShape.circle,
                      boxShadow: [
                        BoxShadow(
                          color: Colors.black.withOpacity(0.2),
                          blurRadius: 6,
                          offset: const Offset(0, 3),
                        ),
                      ],
                    ),
                  ),
                  const Icon(
                    Icons.local_shipping,
                    color: Color(0xFF8B1A1A), // Truxify accent color
                    size: 24.0,
                  ),
                ],
              ),
            ),
          ],
        ),
      ],
    );
  }
}
