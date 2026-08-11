import 'package:flutter/material.dart';
import '../models/trailer_listing_model.dart';
import '../services/trailer_leasing_service.dart';

class TrailerMarketplaceDashboard extends StatefulWidget {
  const TrailerMarketplaceDashboard({super.key});

  @override
  State<TrailerMarketplaceDashboard> createState() => _TrailerMarketplaceDashboardState();
}

class _TrailerMarketplaceDashboardState extends State<TrailerMarketplaceDashboard> {
  final TrailerLeasingService _leasingService = TrailerLeasingService();
  bool _isSearching = false;
  List<TrailerListing> _listings = [];

  void _searchTrailers() async {
    setState(() {
      _isSearching = true;
    });

    final results = await _leasingService.searchAvailableTrailers('60601', 'Any');

    if (mounted) {
      setState(() {
        _isSearching = false;
        _listings = results;
      });
    }
  }

  void _bookTrailer(TrailerListing trailer) async {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) => AlertDialog(
        title: const Text('Processing Booking...'),
        content: const CircularProgressIndicator(),
      )
    );
    
    final success = await _leasingService.bookTrailer(trailer.trailerId, 3);
    
    if (mounted && success) {
      Navigator.pop(context); // Close loading
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Successfully booked ${trailer.trailerId} for 3 days! Insurance escrow funded.'),
          backgroundColor: Colors.green,
        )
      );
      setState(() {
        _listings.removeWhere((t) => t.trailerId == trailer.trailerId);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('P2P Trailer Marketplace'),
        backgroundColor: Colors.amber[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          Container(
            padding: const EdgeInsets.all(24),
            color: Colors.white,
            width: double.infinity,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Find Idle Equipment Near You', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
                const SizedBox(height: 8),
                const Text('Rent directly from other verified Truxify carriers.', style: TextStyle(color: Colors.grey)),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton.icon(
                    onPressed: _isSearching ? null : _searchTrailers,
                    icon: const Icon(Icons.search),
                    label: Text(_isSearching ? 'SCANNING YARDS...' : 'SEARCH 50 MILE RADIUS'),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.amber[900], foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(vertical: 16)),
                  ),
                )
              ],
            ),
          ),
          Expanded(
            child: _listings.isEmpty && !_isSearching
                ? const Center(child: Text('Click search to find available trailers.'))
                : _isSearching
                    ? const Center(child: CircularProgressIndicator(color: Colors.amber))
                    : ListView.builder(
                        padding: const EdgeInsets.all(16),
                        itemCount: _listings.length,
                        itemBuilder: (context, index) {
                          return _buildListingCard(_listings[index]);
                        },
                      ),
          )
        ],
      ),
    );
  }

  Widget _buildListingCard(TrailerListing listing) {
    IconData typeIcon = Icons.local_shipping;
    if (listing.trailerType.contains('Reefer')) typeIcon = Icons.ac_unit;
    if (listing.trailerType.contains('Flatbed')) typeIcon = Icons.flatware; // Using flatware as a stand-in for flatbed

    return Card(
      margin: const EdgeInsets.only(bottom: 16),
      elevation: 2,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Row(
                  children: [
                    CircleAvatar(backgroundColor: Colors.amber[100], child: Icon(typeIcon, color: Colors.amber[900])),
                    const SizedBox(width: 12),
                    Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(listing.trailerType, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
                        Text(listing.trailerId, style: const TextStyle(color: Colors.grey)),
                      ],
                    ),
                  ],
                ),
                Column(
                  crossAxisAlignment: CrossAxisAlignment.end,
                  children: [
                    Text('\$${listing.dailyRate.toStringAsFixed(2)}', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 22, color: Colors.green)),
                    const Text('per day', style: TextStyle(color: Colors.grey, fontSize: 12)),
                  ],
                )
              ],
            ),
            const Divider(height: 32),
            Row(
              children: [
                const Icon(Icons.business, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Expanded(child: Text(listing.ownerCompany, style: const TextStyle(fontWeight: FontWeight.bold))),
                const Icon(Icons.star, size: 16, color: Colors.amber),
                Text(listing.rating.toString(), style: const TextStyle(fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 8),
            Row(
              children: [
                const Icon(Icons.location_on, size: 16, color: Colors.grey),
                const SizedBox(width: 8),
                Text(listing.location),
              ],
            ),
            const SizedBox(height: 16),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _bookTrailer(listing),
                style: ElevatedButton.styleFrom(backgroundColor: Colors.amber[900], foregroundColor: Colors.white),
                child: const Text('BOOK INSTANTLY'),
              ),
            )
          ],
        ),
      ),
    );
  }
}
