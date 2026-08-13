import 'package:flutter/material.dart';
import '../models/collaborative_dispatch_model.dart';
import '../services/collaborative_dispatch_service.dart';

class CollaborativeDispatchScreen extends StatefulWidget {
  const CollaborativeDispatchScreen({super.key});

  @override
  State<CollaborativeDispatchScreen> createState() => _CollaborativeDispatchScreenState();
}

class _CollaborativeDispatchScreenState extends State<CollaborativeDispatchScreen> {
  final CollaborativeDispatchService _service = CollaborativeDispatchService();
  CollaborativeDispatchSession? _session;

  @override
  void initState() {
    super.initState();
    _service.syncStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    _service.connectWebSocket();
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
        title: const Text('Multi-Player Dispatch'),
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

    return Stack(
      children: [
        Column(
          children: [
            _buildStatusHeader(s),
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  const Text('LIVE DISPATCH BOARD', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                  const SizedBox(height: 12),
                  ...s.availableLoads.map((load) => _buildLoadCard(load)),
                ],
              ),
            )
          ],
        ),
        // Mocking remote cursors
        if (s.status.contains('Connected')) ...s.activeCursors.map((c) => _buildMockCursor(c)),
      ],
    );
  }

  Widget _buildStatusHeader(CollaborativeDispatchSession s) {
    bool isConnected = s.status.contains('Connected');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(24),
      color: isConnected ? Colors.indigo[800] : Colors.blueGrey[800],
      child: Column(
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(isConnected ? Icons.wifi : Icons.wifi_find, color: Colors.white, size: 36),
              const SizedBox(width: 12),
              const Text('WEBSOCKET SYNC', style: TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
            ],
          ),
          const SizedBox(height: 16),
          Text(s.status.toUpperCase(), textAlign: TextAlign.center, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
        ],
      ),
    );
  }

  Widget _buildLoadCard(DispatchLoadItem load) {
    bool isLocked = load.isLocked;
    bool isLockedByMe = load.lockedByUserId == 'ME';
    Color lockColor = isLocked ? Color(int.tryParse(load.lockedColorHex ?? '') ?? 0xFF888888) : Colors.transparent;

    return GestureDetector(
      onTap: () {
        if (!isLocked) {
          _service.lockLoad(load.loadId);
        } else if (isLockedByMe) {
          _service.unlockLoad(load.loadId);
        }
      },
      child: AnimatedContainer(
        duration: const Duration(milliseconds: 200),
        margin: const EdgeInsets.only(bottom: 12),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: isLocked ? lockColor : Colors.transparent, width: 2),
          boxShadow: const [BoxShadow(color: Colors.black12, blurRadius: 4, offset: Offset(0, 2))],
        ),
        child: ListTile(
          contentPadding: const EdgeInsets.all(16),
          leading: CircleAvatar(
            backgroundColor: isLocked ? lockColor.withOpacity(0.2) : Colors.blueGrey[50],
            child: Icon(isLocked ? Icons.lock : Icons.local_shipping, color: isLocked ? lockColor : Colors.blueGrey),
          ),
          title: Text('${load.origin} ➔ ${load.destination}', style: TextStyle(fontWeight: FontWeight.bold, color: isLocked ? lockColor : Colors.black87)),
          subtitle: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 4),
              Text('Load ID: ${load.loadId}'),
              if (isLocked) ...[
                const SizedBox(height: 8),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(color: lockColor.withOpacity(0.1), borderRadius: BorderRadius.circular(4)),
                  child: Text('Editing: ${load.lockedByUserName}', style: TextStyle(color: lockColor, fontSize: 12, fontWeight: FontWeight.bold)),
                )
              ]
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildMockCursor(DispatchCursor c) {
    Color cursorColor = Color(int.parse(c.colorHex));
    
    // Using a tween to make the mock cursor 'float' a bit
    return Positioned(
      left: c.xOffset,
      top: c.yOffset,
      child: IgnorePointer(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(Icons.navigation, color: cursorColor, size: 24, shadows: const [Shadow(color: Colors.black45, blurRadius: 2)]),
            Container(
              margin: const EdgeInsets.only(left: 12),
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
              decoration: BoxDecoration(color: cursorColor, borderRadius: BorderRadius.circular(4)),
              child: Text(c.userName, style: const TextStyle(color: Colors.white, fontSize: 10, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }
}
