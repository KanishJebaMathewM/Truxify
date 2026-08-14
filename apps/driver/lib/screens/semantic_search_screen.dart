import 'package:flutter/material.dart';
import '../models/semantic_search_model.dart';
import '../services/semantic_search_service.dart';

class SemanticSearchScreen extends StatefulWidget {
  const SemanticSearchScreen({super.key});

  @override
  State<SemanticSearchScreen> createState() => _SemanticSearchScreenState();
}

class _SemanticSearchScreenState extends State<SemanticSearchScreen> {
  final SemanticSearchService _service = SemanticSearchService();
  final TextEditingController _queryController = TextEditingController();
  SemanticSearchSession? _session;

  @override
  void initState() {
    super.initState();
    _service.searchStream.listen((data) {
      if (mounted) setState(() => _session = data);
    });
    // Set default query to match the mock
    _queryController.text = "I want to take flatbed freight from Texas to the Midwest paying over \$2 a mile";
  }

  @override
  void dispose() {
    _service.dispose();
    _queryController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Natural Language Load Search'),
        backgroundColor: Colors.blueGrey[900],
      ),
      backgroundColor: Colors.grey[200],
      body: Column(
        children: [
          _buildSearchBox(),
          Expanded(
            child: _session == null
                ? const Center(child: Text('Type a natural language query to begin.'))
                : _buildDashboard(),
          ),
        ],
      )
    );
  }

  Widget _buildSearchBox() {
    return Container(
      color: Colors.white,
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.end,
        children: [
          TextField(
            controller: _queryController,
            maxLines: 3,
            decoration: InputDecoration(
              hintText: 'e.g., "Find me reefer loads out of Atlanta paying at least \$3/mi going anywhere..."',
              border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
              filled: true,
              fillColor: Colors.grey[100],
            ),
          ),
          const SizedBox(height: 12),
          ElevatedButton.icon(
            onPressed: () {
              if (_queryController.text.isNotEmpty) {
                _service.executeSearch(_queryController.text);
              }
            },
            icon: const Icon(Icons.search),
            label: const Text('Semantic Search'),
            style: ElevatedButton.styleFrom(
              backgroundColor: Colors.indigo,
              foregroundColor: Colors.white,
            ),
          )
        ],
      ),
    );
  }

  Widget _buildDashboard() {
    final s = _session!;

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _buildStatusHeader(s),
        const SizedBox(height: 16),
        if (s.parsedIntent != null) _buildParsedIntentCard(s.parsedIntent!),
        const SizedBox(height: 24),
        if (s.status.contains('Complete')) ...[
          Text('RESULTS (${s.results.length})', style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
          const SizedBox(height: 12),
          ...s.results.map((r) => _buildResultCard(r)),
        ] else if (s.parsedIntent != null) ...[
          const Center(child: CircularProgressIndicator()),
        ]
      ],
    );
  }

  Widget _buildStatusHeader(SemanticSearchSession s) {
    bool isComplete = s.status.contains('Complete');

    return AnimatedContainer(
      duration: const Duration(milliseconds: 300),
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isComplete ? Colors.indigo[800] : Colors.blueGrey[800],
        borderRadius: BorderRadius.circular(12),
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(isComplete ? Icons.check_circle : Icons.psychology, color: Colors.white),
          const SizedBox(width: 12),
          Text(s.status.toUpperCase(), style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        ],
      ),
    );
  }

  Widget _buildParsedIntentCard(ParsedSearchIntent intent) {
    return Card(
      elevation: 4,
      color: Colors.indigo[50],
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: Colors.indigo[300]!, width: 2),
      ),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Row(
              children: [
                Icon(Icons.auto_awesome, color: Colors.indigo),
                SizedBox(width: 8),
                Text('NLP Parsed Parameters', style: TextStyle(color: Colors.indigo, fontWeight: FontWeight.bold)),
              ],
            ),
            const Divider(height: 24),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                _buildParameterChip('Origin', intent.originRegion),
                _buildParameterChip('Dest', intent.destinationRegion),
                _buildParameterChip('Equip', intent.equipmentType),
                _buildParameterChip('Rate', '>\$${intent.minimumRate.toStringAsFixed(2)}/mi'),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildParameterChip(String label, String value) {
    return Chip(
      backgroundColor: Colors.white,
      label: Text('$label: $value', style: const TextStyle(fontWeight: FontWeight.bold, color: Colors.indigo)),
      side: BorderSide(color: Colors.indigo[100]!),
    );
  }

  Widget _buildResultCard(SearchResultLoad r) {
    return Card(
      elevation: 1,
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: const CircleAvatar(
          backgroundColor: Colors.green,
          child: Icon(Icons.attach_money, color: Colors.white),
        ),
        title: Text('${r.origin} ➔ ${r.destination}', style: const TextStyle(fontWeight: FontWeight.bold)),
        subtitle: Text(r.equipment),
        trailing: Text('\$${r.ratePerMile.toStringAsFixed(2)}/mi', style: const TextStyle(color: Colors.green, fontWeight: FontWeight.bold, fontSize: 16)),
      ),
    );
  }
}
