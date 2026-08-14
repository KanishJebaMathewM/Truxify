import 'package:flutter/material.dart';
import '../models/yms_ar_micro_location_model.dart';
import '../services/yms_ar_micro_location_service.dart';

class YmsArMicroLocationScreen extends StatefulWidget {
  final String targetTrailerId;
  const YmsArMicroLocationScreen({super.key, this.targetTrailerId = 'TRL-99214'});

  @override
  State<YmsArMicroLocationScreen> createState() => _YmsArMicroLocationScreenState();
}

class _YmsArMicroLocationScreenState extends State<YmsArMicroLocationScreen> {
  final YmsArMicroLocationService _service = YmsArMicroLocationService();
  TrailerMicroLocation? _trailer;
  bool _isLoading = true;
  bool _isArActive = false;

  @override
  void initState() {
    super.initState();
    _fetchLocation();
  }

  void _fetchLocation() async {
    final t = await _service.locateTrailer(widget.targetTrailerId);
    if (mounted) {
      setState(() {
        _trailer = t;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('YMS Trailer Finder'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _isLoading
          ? const Center(child: CircularProgressIndicator())
          : Column(
              children: [
                _buildHeader(),
                Expanded(
                  child: _isArActive ? _buildArCameraView() : _buildMapPlaceholder(),
                ),
                _buildActionBar(),
              ],
            ),
    );
  }

  Widget _buildHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text('Target: ${_trailer!.trailerId}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                child: const Text('LOCATED', style: TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
              )
            ],
          ),
          const SizedBox(height: 8),
          Text('Dropped 14 hours ago in ${_trailer!.exactLocation.slotId}', style: const TextStyle(color: Colors.grey)),
        ],
      ),
    );
  }

  Widget _buildMapPlaceholder() {
    return Container(
      width: double.infinity,
      color: Colors.grey[300],
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Icon(Icons.map, size: 120, color: Colors.white),
          Positioned(
            bottom: 32,
            child: ElevatedButton.icon(
              onPressed: () => setState(() => _isArActive = true),
              icon: const Icon(Icons.view_in_ar),
              label: const Text('LAUNCH AR WALKING DIRECTIONS', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.blueAccent, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 16)),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildArCameraView() {
    return Container(
      width: double.infinity,
      color: Colors.black, // Simulating camera feed
      child: Stack(
        alignment: Alignment.center,
        children: [
          const Text('[ CAMERA FEED ACTIVE ]', style: TextStyle(color: Colors.white38, letterSpacing: 2)),
          
          // Simulated AR Overlay
          Positioned(
            top: 60,
            child: Column(
              children: [
                const Icon(Icons.keyboard_double_arrow_up, color: Colors.blueAccent, size: 80),
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  decoration: BoxDecoration(color: Colors.blueAccent.withOpacity(0.8), borderRadius: BorderRadius.circular(20)),
                  child: const Text('Walk forward 400 ft', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
                )
              ],
            ),
          ),
          Positioned(
            bottom: 32,
            child: FloatingActionButton(
              backgroundColor: Colors.white,
              onPressed: () => setState(() => _isArActive = false),
              child: const Icon(Icons.close, color: Colors.black),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildActionBar() {
    return Container(
      padding: const EdgeInsets.all(24),
      color: Colors.white,
      child: SizedBox(
        width: double.infinity,
        height: 56,
        child: ElevatedButton.icon(
          onPressed: () {},
          icon: const Icon(Icons.pin_drop),
          label: const Text('DROP TRAILER HERE', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
          style: ElevatedButton.styleFrom(backgroundColor: Colors.blueGrey[900], foregroundColor: Colors.white),
        ),
      ),
    );
  }
}
