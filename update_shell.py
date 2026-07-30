import re

file_path = 'apps/driver/lib/screens/shell_screen.dart'
with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Add import
import_stmt = "import '../services/weigh_station_service.dart';"
content = content.replace("import '../widgets/bottom_nav_bar.dart';", "import '../widgets/bottom_nav_bar.dart';\nimport '../services/weigh_station_service.dart';\nimport 'dart:async';")

# Add subscription variable
state_class_start = content.find("class _ShellScreenState extends State<ShellScreen> {")
var_insert_point = content.find("final ValueNotifier<int> _currentIndex = ValueNotifier<int>(0);")
if var_insert_point != -1:
    content = content[:var_insert_point] + "StreamSubscription? _weighStationSub;\n    " + content[var_insert_point:]

# Add init and dispose
init_start = content.find("void initState() {")
super_init = content.find("super.initState();", init_start) + len("super.initState();")

init_code = '''
    WeighStationService.instance.initialize();
    _weighStationSub = WeighStationService.instance.eventStream.listen((event) {
      _showBypassAlert(event);
    });
'''
content = content[:super_init] + init_code + content[super_init:]

# add _showBypassAlert method and dispose
dispose_method = '''
  @override
  void dispose() {
    _weighStationSub?.cancel();
    super.dispose();
  }

  void _showBypassAlert(WeighStationEvent event) {
    if (!mounted) return;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (context) {
        final isBypass = event.action == 'BYPASS';
        return Dialog(
          backgroundColor: isBypass ? const Color(0xFF1E4620) : const Color(0xFF5C1A1A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(24)),
          child: Padding(
            padding: const EdgeInsets.all(32.0),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  isBypass ? Icons.check_circle_outline : Icons.warning_amber_rounded,
                  size: 80,
                  color: Colors.white,
                ),
                const SizedBox(height: 24),
                Text(
                  isBypass ? 'BYPASS CLEARED' : 'PULL IN REQUIRED',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 28,
                    fontWeight: FontWeight.bold,
                    color: Colors.white,
                  ),
                ),
                const SizedBox(height: 16),
                Text(
                  'Station ID: ${event.stationId}\\n${event.reason}',
                  textAlign: TextAlign.center,
                  style: const TextStyle(
                    fontSize: 16,
                    color: Colors.white70,
                  ),
                ),
                const SizedBox(height: 32),
                SizedBox(
                  width: double.infinity,
                  height: 56,
                  child: ElevatedButton(
                    style: ElevatedButton.styleFrom(
                      backgroundColor: Colors.white,
                      foregroundColor: isBypass ? const Color(0xFF1E4620) : const Color(0xFF5C1A1A),
                      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                    ),
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('ACKNOWLEDGE', style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold)),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    );
  }
'''

# insert before final brace
build_method_start = content.find("Widget build(BuildContext context) {")
content = content[:build_method_start] + dispose_method + "\n  " + content[build_method_start:]

with open(file_path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
