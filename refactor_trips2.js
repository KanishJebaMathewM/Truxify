const fs = require('fs');

const screenPath = 'apps/driver/lib/screens/trips_screen.dart';
let screenCode = fs.readFileSync(screenPath, 'utf8');

// The controller is already created in apps/driver/lib/controllers/trips_controller.dart
// We just need to modify trips_screen.dart.

let topRegex = /class _TripsScreenState extends State<TripsScreen> \{[\s\S]*?final List<String> _statusFilters/;

let newTop = `import '../controllers/trips_controller.dart';\n\nclass _TripsScreenState extends State<TripsScreen> {
  final TripsController ctrl = TripsController();
  final ScrollController _scrollController = ScrollController();

  final List<String> _statusFilters`;

screenCode = screenCode.replace(topRegex, newTop);

let initRegex = /@override\s*void initState\(\) \{[\s\S]*?\}\s*Future<void> _loadTrips/m;
let newInit = `@override
  void initState() {
    super.initState();
    _scrollController.addListener(_onScroll);
  }

  void _onScroll() {
    if (_scrollController.position.pixels >= _scrollController.position.maxScrollExtent - 200) {
      ctrl.loadMoreTrips();
    }
  }

  Future<void> _loadTrips`;

screenCode = screenCode.replace(initRegex, newInit);

let methodsRegex = /Future<void> _loadTrips\(\) async \{[\s\S]*?@override\s*void dispose\(\) \{[\s\S]*?super\.dispose\(\);\s*\}/m;
let newMethods = `@override
  void dispose() {
    _scrollController.dispose();
    ctrl.dispose();
    super.dispose();
  }`;
screenCode = screenCode.replace(methodsRegex, newMethods);

let buildRegex = /Widget build\(BuildContext context\) \{([\s\S]*?final colorScheme = Theme\.of\(context\)\.colorScheme;)/;
let newBuild = `Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: ctrl,
      builder: (context, _) {
        $1`;
screenCode = screenCode.replace(buildRegex, newBuild);

// Wait, if we inject ListenableBuilder, we need to close it at the very end of the class.
// The end of the file should look like:
//   }
// }
// We want it to be:
//       },
//     );
//   }
// }
screenCode = screenCode.replace(/}\s*}$/, "    },\n    );\n  }\n}");

let replacements = {
  '_selectedChipIndex': 'ctrl.selectedChipIndex',
  '_selectedSortIndex': 'ctrl.selectedSortIndex',
  '_topTabIndex': 'ctrl.topTabIndex',
  '_tripsError': 'ctrl.tripsError',
  '_hasMoreTrips': 'ctrl.hasMoreTrips',
  '_isOfflineTripsData': 'ctrl.isOfflineTripsData',
  '_offlineTripsSavedAt': 'ctrl.offlineTripsSavedAt',
  '_marketplaceLoading': 'ctrl.marketplaceLoading',
  '_marketplaceError': 'ctrl.marketplaceError',
  '_marketplaceLoads': 'ctrl.marketplaceLoads',
  '_enRouteLoads': 'ctrl.enRouteLoads',
  '_bidsByLoadId': 'ctrl.bidsByLoadId',
  '_trips': 'ctrl.trips',
  '_isLoadingTrips': 'ctrl.isLoadingTrips',
  '_isLoadingMoreTrips': 'ctrl.isLoadingMoreTrips',
  '_tripStopsByTripId': 'ctrl.tripStopsByTripId',
  '_routePointsByTripId': 'ctrl.routePointsByTripId',
  '_getStatusTypeFromIndex': 'ctrl.getStatusTypeFromIndex',
  '_getStatusType': 'ctrl.getStatusType',
  '_parseEarnings': 'ctrl.parseEarnings',
  '_totalEarningsPaise': 'ctrl.totalEarningsPaise',
  '_completedCount': 'ctrl.completedCount',
  '_completionRate': 'ctrl.completionRate',
  '_formatEarnings': 'ctrl.formatEarnings',
  '_refreshMarketplace': 'ctrl.refreshMarketplace',
  '_loadMoreTrips': 'ctrl.loadMoreTrips',
  '_loadTrips': 'ctrl.loadTrips',
};

screenCode = screenCode.replace(/setState\(\(\) => _selectedSortIndex = (.*?)\);/g, 'ctrl.setSelectedSortIndex($1);');
screenCode = screenCode.replace(/setState\(\(\) => _selectedChipIndex = (.*?)\);/g, 'ctrl.setSelectedChipIndex($1);');
screenCode = screenCode.replace(/setState\(\(\) \{\s*_topTabIndex = (.*?);\s*\}\);/g, 'ctrl.setTopTabIndex($1);');

for (const [key, value] of Object.entries(replacements)) {
  const regex = new RegExp(key, 'g');
  screenCode = screenCode.replace(regex, value);
}

fs.writeFileSync('apps/driver/lib/screens/trips_screen.dart', screenCode);
console.log("Refactored successfully.");
