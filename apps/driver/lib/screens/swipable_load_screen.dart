import 'package:flutter/material.dart';
import '../models/swipable_load_model.dart';
import '../services/swipable_load_service.dart';

class SwipableLoadScreen extends StatefulWidget {
  const SwipableLoadScreen({super.key});

  @override
  State<SwipableLoadScreen> createState() => _SwipableLoadScreenState();
}

class _SwipableLoadScreenState extends State<SwipableLoadScreen> {
  final SwipableLoadService _service = SwipableLoadService();
  SwipableSession? _session;

  @override
  void initState() {
    super.initState();
    _service.loadStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.fetchLoads();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Tinder for Freight'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: _session == null
          ? const Center(child: CircularProgressIndicator())
          : _buildDashboard(),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return Column(
      children: [
        _buildStatusHeader(s),
        Expanded(
          child: Stack(
            alignment: Alignment.center,
            children: [
              if (s.pendingLoads.isEmpty)
                const Column(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.search_off, size: 64, color: Colors.blueGrey),
                    SizedBox(height: 16),
                    Text('No more loads in your area.', style: TextStyle(fontSize: 18, color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                  ],
                )
              else
                // Render the cards in reverse order so the top one is the first item
                ...s.pendingLoads.reversed.map((load) => _buildSwipableCard(load, isTop: load == s.pendingLoads.first)),
            ],
          ),
        ),
        _buildActionButtons(s),
      ],
    );
  }

  Widget _buildStatusHeader(SwipableSession s) {
    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      color: Colors.blue[800],
      child: Text(s.status, textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
    );
  }

  Widget _buildSwipableCard(FreightLoad load, {required bool isTop}) {
    // Basic implementation of a swipable card using Dismissible
    return Positioned(
      top: 32,
      left: 16,
      right: 16,
      bottom: 64,
      child: IgnorePointer(
        ignoring: !isTop, // Only the top card can be swiped
        child: Dismissible(
          key: Key(load.loadId),
          onDismissed: (direction) {
            if (direction == DismissDirection.endToStart) {
              _service.swipeLeft(load); // Swipe Left = Reject
            } else if (direction == DismissDirection.startToEnd) {
              _service.swipeRight(load); // Swipe Right = Accept
            }
          },
          background: _buildSwipeBackground(Colors.green, Icons.check_circle, Alignment.centerLeft, "BOOK LOAD"),
          secondaryBackground: _buildSwipeBackground(Colors.red, Icons.cancel, Alignment.centerRight, "PASS"),
          child: Card(
            elevation: isTop ? 12 : 2,
            shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(24),
                gradient: LinearGradient(
                  colors: [Colors.white, Colors.grey[50]!],
                  begin: Alignment.topCenter,
                  end: Alignment.bottomCenter,
                )
              ),
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Column(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Column(
                      children: [
                        Text('\$${load.payout.toStringAsFixed(0)}', style: TextStyle(fontSize: 56, fontWeight: FontWeight.bold, color: Colors.green[800])),
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                          decoration: BoxDecoration(color: Colors.green[50], borderRadius: BorderRadius.circular(20)),
                          child: Text('\$${load.ratePerMile.toStringAsFixed(2)} / mile', style: TextStyle(color: Colors.green[800], fontWeight: FontWeight.bold, fontSize: 18)),
                        ),
                      ],
                    ),
                    Column(
                      children: [
                        Row(
                          children: [
                            const Icon(Icons.location_on, color: Colors.blue),
                            const SizedBox(width: 12),
                            Text(load.origin, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                          ],
                        ),
                        Container(
                          height: 40,
                          margin: const EdgeInsets.only(left: 11),
                          decoration: const BoxDecoration(
                            border: Border(left: BorderSide(color: Colors.grey, width: 2, style: BorderStyle.solid)),
                          ),
                          child: Align(
                            alignment: Alignment.centerLeft,
                            child: Padding(
                              padding: const EdgeInsets.only(left: 20),
                              child: Text('${load.miles} Miles', style: const TextStyle(color: Colors.blueGrey, fontWeight: FontWeight.bold)),
                            ),
                          ),
                        ),
                        Row(
                          children: [
                            const Icon(Icons.flag, color: Colors.red),
                            const SizedBox(width: 12),
                            Text(load.destination, style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                          ],
                        ),
                      ],
                    ),
                    Row(
                      mainAxisAlignment: MainAxisAlignment.spaceAround,
                      children: [
                        _buildDetailChip(Icons.local_shipping, load.equipmentType),
                        _buildDetailChip(Icons.scale, '${load.weightLbs} lbs'),
                      ],
                    )
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }

  Widget _buildSwipeBackground(Color color, IconData icon, Alignment alignment, String text) {
    return Container(
      decoration: BoxDecoration(
        color: color,
        borderRadius: BorderRadius.circular(24),
      ),
      padding: const EdgeInsets.all(32),
      alignment: alignment,
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(icon, color: Colors.white, size: 64),
          const SizedBox(height: 12),
          Text(text, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 24)),
        ],
      ),
    );
  }

  Widget _buildDetailChip(IconData icon, String text) {
    return Column(
      children: [
        Icon(icon, color: Colors.blueGrey),
        const SizedBox(height: 8),
        Text(text, style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.blueGrey)),
      ],
    );
  }

  Widget _buildActionButtons(SwipableSession s) {
    if (s.pendingLoads.isEmpty) return const SizedBox(height: 80);

    return Container(
      padding: const EdgeInsets.only(bottom: 32, left: 32, right: 32),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceEvenly,
        children: [
          FloatingActionButton(
            heroTag: 'pass_btn',
            onPressed: () => _service.swipeLeft(s.pendingLoads.first),
            backgroundColor: Colors.white,
            foregroundColor: Colors.red,
            elevation: 4,
            child: const Icon(Icons.close, size: 32),
          ),
          FloatingActionButton.large(
            heroTag: 'book_btn',
            onPressed: () => _service.swipeRight(s.pendingLoads.first),
            backgroundColor: Colors.green,
            foregroundColor: Colors.white,
            elevation: 8,
            child: const Icon(Icons.local_shipping, size: 40),
          ),
        ],
      ),
    );
  }
}
