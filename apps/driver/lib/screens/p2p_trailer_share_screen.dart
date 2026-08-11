import 'package:flutter/material.dart';
import '../models/p2p_trailer_share_model.dart';
import '../services/p2p_trailer_share_service.dart';

class P2pTrailerShareScreen extends StatefulWidget {
  const P2pTrailerShareScreen({super.key});

  @override
  State<P2pTrailerShareScreen> createState() => _P2pTrailerShareScreenState();
}

class _P2pTrailerShareScreenState extends State<P2pTrailerShareScreen> {
  final P2pTrailerShareService _service = P2pTrailerShareService();
  List<TrailerListing>? _listings;
  bool _isSearching = false;

  void _runSearch() async {
    setState(() {
      _isSearching = true;
      _listings = null;
    });

    final results = await _service.searchAvailableTrailers('Chicago, IL', 'Detroit, MI');

    if (mounted) {
      setState(() {
        _listings = results;
        _isSearching = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('P2P Trailer Network'),
        backgroundColor: Colors.blue[900],
      ),
      backgroundColor: Colors.grey[100],
      body: Column(
        children: [
          _buildSearchHeader(),
          Expanded(
            child: _isSearching
                ? const Center(child: CircularProgressIndicator())
                : _listings == null
                    ? _buildEmptyState()
                    : _buildListingsList(),
          )
        ],
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: const BoxDecoration(
        color: Colors.white,
        boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 8)],
      ),
      child: Column(
        children: [
          const Row(
            children: [
              Icon(Icons.trip_origin, color: Colors.blue),
              SizedBox(width: 12),
              Text('Chicago, IL', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const Padding(
            padding: EdgeInsets.only(left: 10, top: 4, bottom: 4),
            child: Align(
              alignment: Alignment.centerLeft,
              child: SizedBox(height: 20, child: VerticalDivider(color: Colors.grey, thickness: 2)),
            ),
          ),
          const Row(
            children: [
              Icon(Icons.location_on, color: Colors.red),
              SizedBox(width: 12),
              Text('Detroit, MI', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
            ],
          ),
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            height: 50,
            child: ElevatedButton.icon(
              onPressed: _isSearching ? null : _runSearch,
              icon: const Icon(Icons.search),
              label: const Text('SEARCH AVAILABLE TRAILERS', style: TextStyle(fontWeight: FontWeight.bold)),
              style: ElevatedButton.styleFrom(backgroundColor: Colors.blue[900], foregroundColor: Colors.white),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildEmptyState() {
    return Center(
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(Icons.rv_hookup, size: 80, color: Colors.grey[300]),
          const SizedBox(height: 16),
          Text('Find empty trailers that need repositioning.', style: TextStyle(color: Colors.grey[500])),
        ],
      ),
    );
  }

  Widget _buildListingsList() {
    return ListView.builder(
      padding: const EdgeInsets.all(16),
      itemCount: _listings!.length,
      itemBuilder: (context, index) {
        final item = _listings![index];
        return Card(
          margin: const EdgeInsets.only(bottom: 16),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          elevation: 2,
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(item.trailerType, style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                      decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(12)),
                      child: Text('${item.matchScorePct}% Match', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
                const SizedBox(height: 4),
                Text('Owner: ${item.ownerName}', style: const TextStyle(color: Colors.grey)),
                const Divider(height: 32),
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    const Text('Rental Price:', style: TextStyle(fontSize: 16)),
                    Text(
                      item.rentalPriceUsd == 0 ? 'FREE REPOSITION' : '\$${item.rentalPriceUsd.toStringAsFixed(2)}',
                      style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: item.rentalPriceUsd == 0 ? Colors.green[800] : Colors.black),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  child: OutlinedButton(
                    onPressed: () {},
                    style: OutlinedButton.styleFrom(foregroundColor: Colors.blue[900], side: BorderSide(color: Colors.blue[900]!)),
                    child: const Text('REQUEST RENTAL'),
                  ),
                )
              ],
            ),
          ),
        );
      },
    );
  }
}
