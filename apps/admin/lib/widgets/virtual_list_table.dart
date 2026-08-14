import 'package:flutter/material.dart';
import '../services/memory_reclaimer.dart';

/// Virtualized Data Table Widget for Admin Analytics Dashboard
class VirtualListTable extends StatefulWidget {
  final List<Map<String, dynamic>> logRows;
  final double itemExtent;

  const VirtualListTable({
    Key? key,
    required this.logRows,
    this.itemExtent = 48.0,
  }) : super(key: key);

  @override
  State<VirtualListTable> createState() => _VirtualListTableState();
}

class _VirtualListTableState extends State<VirtualListTable> {
  final ScrollController _scrollController = ScrollController();
  final WebGLMemoryReclaimerService _reclaimer = WebGLMemoryReclaimerService();

  @override
  void initState() {
    super.initState();
    _scrollController.addListener(() {
      _reclaimer.purgeOffscreenCanvasMemory();
    });
  }

  @override
  void dispose() {
    _scrollController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return ListView.builder(
      controller: _scrollController,
      itemCount: widget.logRows.length,
      itemExtent: widget.itemExtent,
      itemBuilder: (context, index) {
        final row = widget.logRows[index];
        return Container(
          decoration: const BoxDecoration(
            border: Border(bottom: BorderSide(color: Color(0xFF2C2C3E))),
          ),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                row['timestamp'] ?? '',
                style: const TextStyle(color: Colors.white70, fontSize: 13),
              ),
              Text(
                row['event'] ?? '',
                style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w500),
              ),
              Text(
                row['status'] ?? '',
                style: TextStyle(
                  color: row['status'] == 'ERROR' ? Colors.redAccent : Colors.greenAccent,
                  fontSize: 12,
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}
