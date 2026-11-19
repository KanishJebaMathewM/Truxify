import 'package:flutter/material.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:truxify_shared/truxify_shared.dart';
import 'utils/support_ticket_parser.dart';

/// Backend connection settings, injected at build time via --dart-define.
class AdminApiConfig {
  static const String _envUrl = String.fromEnvironment('ADMIN_API_URL');
  // static const String _envToken removed for security (#14937)

  static String get baseUrl {
    final url = _envUrl.isNotEmpty ? _envUrl : 'http://localhost:5000';
    if (kReleaseMode) {
      if (!url.startsWith('https://')) {
        throw StateError(
          'ADMIN_API_URL must be an HTTPS URL in release mode. '
          'Set --dart-define=ADMIN_API_URL=https://...',
        );
      }
    }
    return url;
  }

  static String? get authToken => null;
}

void main() {
  runApp(const AdminDashboardApp());
}

class AdminDashboardApp extends StatefulWidget {
  const AdminDashboardApp({super.key});

  @override
  State<AdminDashboardApp> createState() => _AdminDashboardAppState();
}

class _AdminDashboardAppState extends State<AdminDashboardApp> {
  final ThemeProvider _themeProvider = ThemeProvider();

  @override
  void initState() {
    super.initState();
    _themeProvider.addListener(_onThemeChanged);
  }

  @override
  void dispose() {
    _themeProvider.removeListener(_onThemeChanged);
    _themeProvider.dispose();
    super.dispose();
  }

  void _onThemeChanged() {
    setState(() {});
  }

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Truxify Admin Dashboard',
      theme: AppTheme.lightTheme,
      darkTheme: AppTheme.darkTheme,
      themeMode: _themeProvider.themeMode,
      home: DashboardShell(themeProvider: _themeProvider),
    );
  }
}

class DashboardShell extends StatefulWidget {
  const DashboardShell({super.key, required this.themeProvider});

  final ThemeProvider themeProvider;

  @override
  State<DashboardShell> createState() => _DashboardShellState();
}

class _DashboardShellState extends State<DashboardShell> {
  int _selectedIndex = 0;

  late final List<Widget> _pages;

  @override
  void initState() {
    super.initState();
    _pages = [
      const UsersView(),
      const TrucksView(),
      const SupportTicketsView(),
      AdminSettingsView(themeProvider: widget.themeProvider),
    ];
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Truxify Admin Panel'),
        actions: [
          ThemeToggle(provider: widget.themeProvider),
          const SizedBox(width: 8),
        ],
      ),
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: _selectedIndex,
            onDestinationSelected: (int index) {
              setState(() {
                _selectedIndex = index;
              });
            },
            labelType: NavigationRailLabelType.all,
            destinations: const [
              NavigationRailDestination(
                icon: Icon(Icons.people_outline),
                selectedIcon: Icon(Icons.people),
                label: Text('Users'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.local_shipping_outlined),
                selectedIcon: Icon(Icons.local_shipping),
                label: Text('Trucks'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.support_agent_outlined),
                selectedIcon: Icon(Icons.support_agent),
                label: Text('Tickets'),
              ),
              NavigationRailDestination(
                icon: Icon(Icons.settings_outlined),
                selectedIcon: Icon(Icons.settings),
                label: Text('Settings'),
              ),
            ],
          ),
          const VerticalDivider(thickness: 1, width: 1),
          Expanded(
            child: _pages[_selectedIndex],
          ),
        ],
      ),
    );
  }
}

class AdminSettingsView extends StatelessWidget {
  const AdminSettingsView({super.key, required this.themeProvider});

  final ThemeProvider themeProvider;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.all(24.0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Settings', style: Theme.of(context).textTheme.headlineMedium),
          const SizedBox(height: 24),
          Card(
            child: Padding(
              padding: const EdgeInsets.all(20.0),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text(
                    'Theme Preference',
                    style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    'Choose how Truxify Admin looks to you. Select Light, Dark, or follow System settings.',
                    style: TextStyle(color: Colors.grey),
                  ),
                  const SizedBox(height: 16),
                  ThemeSegmentedControl(provider: themeProvider),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class UsersView extends StatelessWidget {
  const UsersView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('User Management View (Coming Soon)'),
    );
  }
}

class TrucksView extends StatelessWidget {
  const TrucksView({super.key});

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text('Truck Verification View (Coming Soon)'),
    );
  }
}

class SupportTicketsView extends StatefulWidget {
  const SupportTicketsView({super.key});

  @override
  State<SupportTicketsView> createState() => _SupportTicketsViewState();
}

class _SupportTicketsViewState extends State<SupportTicketsView> {
  List<dynamic> _tickets = [];
  bool _isLoading = true;
  String _error = '';

  @override
  void initState() {
    super.initState();
    _fetchTickets();
  }

  Future<void> _fetchTickets() async {
    try {
      // Base URL is injected via --dart-define=ADMIN_API_URL; the admin
      // credential (Firebase ID token) via --dart-define=ADMIN_API_TOKEN.
      final uri = Uri.parse('${AdminApiConfig.baseUrl}/api/support/admin/tickets');
      final headers = <String, String>{
        'Content-Type': 'application/json',
        if (AdminApiConfig.authToken != null)
          'Authorization': 'Bearer ${AdminApiConfig.authToken}',
      };
      final response = await http.get(uri, headers: headers);
      if (response.statusCode == 200) {
        final ticketsList = parseSupportTicketsResponse(response.body);

        setState(() {
          _tickets = ticketsList;
          _isLoading = false;
        });
      } else {
        setState(() {
          _error = 'Failed to load tickets: ${response.statusCode}';
          _isLoading = false;
        });
      }
    } catch (e) {
      setState(() {
        _error = 'Error connecting to backend: $e';
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    if (_isLoading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error.isNotEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            const Icon(Icons.error_outline, color: Colors.red, size: 48),
            const SizedBox(height: 16),
            Text(_error, style: const TextStyle(color: Colors.red)),
            const SizedBox(height: 16),
            ElevatedButton(
              onPressed: _fetchTickets,
              child: const Text('Retry'),
            ),
          ],
        ),
      );
    }

    if (_tickets.isEmpty) {
      return const Center(child: Text('No active support tickets.'));
    }

    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        DataTable(
          columns: const [
            DataColumn(label: Text('ID')),
            DataColumn(label: Text('User')),
            DataColumn(label: Text('Issue')),
            DataColumn(label: Text('Status')),
            DataColumn(label: Text('Actions')),
          ],
          rows: _tickets.map((ticket) {
            return DataRow(cells: [
              DataCell(Text(ticket['id'].toString())),
              DataCell(Text(ticket['user_id'].toString())),
              DataCell(Text(ticket['subject'] ?? 'N/A')),
              DataCell(Text(ticket['status'] ?? 'Open')),
              DataCell(
                TextButton(
                  onPressed: () {
                    // Placeholder for resolution action
                  },
                  child: const Text('Resolve'),
                ),
              ),
            ]);
          }).toList(),
        ),
      ],
    );
  }
}
