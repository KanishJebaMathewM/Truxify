import 'package:flutter/material.dart';
import '../models/night_vision_model.dart';
import '../services/night_vision_service.dart';

class NightVisionScreen extends StatefulWidget {
  const NightVisionScreen({super.key});

  @override
  State<NightVisionScreen> createState() => _NightVisionScreenState();
}

class _NightVisionScreenState extends State<NightVisionScreen> {
  final NightVisionService _service = NightVisionService();
  NightVisionSettings? _settings;

  @override
  void initState() {
    super.initState();
    _service.settingsStream.listen((data) {
      if (mounted) setState(() => _settings = data);
    });
    _service.initialize();
  }

  @override
  void dispose() {
    _service.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_settings == null) {
      return const Scaffold(
        body: Center(child: CircularProgressIndicator()),
      );
    }

    bool isNight = _settings!.isNightVisionEnabled;

    // Tactical Night Vision Theme
    Color bgColor = isNight ? Colors.black : Colors.grey[100]!;
    Color surfaceColor = isNight ? Colors.black : Colors.white;
    Color textColor = isNight ? Colors.redAccent[700]! : Colors.black87;
    Color secondaryTextColor = isNight ? Colors.red[900]! : Colors.blueGrey;
    Color accentColor = isNight ? Colors.red : Colors.blue;

    return Theme(
      data: ThemeData(
        brightness: isNight ? Brightness.dark : Brightness.light,
        scaffoldBackgroundColor: bgColor,
        cardColor: surfaceColor,
        textTheme: TextTheme(
          bodyLarge: TextStyle(color: textColor),
          bodyMedium: TextStyle(color: textColor),
          titleLarge: TextStyle(color: textColor),
        ),
        appBarTheme: AppBarTheme(
          backgroundColor: isNight ? Colors.black : Colors.blueGrey[900],
          foregroundColor: isNight ? Colors.redAccent[700] : Colors.white,
          elevation: isNight ? 0 : 4,
          shadowColor: isNight ? Colors.redAccent.withOpacity(0.2) : Colors.black,
        ),
      ),
      child: Scaffold(
        appBar: AppBar(
          title: const Text('Tactical Navigation'),
          actions: [
            Switch(
              value: isNight,
              onChanged: _service.toggleNightVision,
              activeColor: Colors.red,
              activeTrackColor: Colors.red[900],
            ),
            const SizedBox(width: 16),
          ],
        ),
        body: Container(
          decoration: isNight ? BoxDecoration(
            border: Border.all(color: Colors.red[900]!, width: 2), // Gives a tactical HUD feel
          ) : null,
          child: Column(
            children: [
              _buildHudHeader(isNight),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _buildRouteCard(isNight, surfaceColor, textColor, secondaryTextColor, accentColor),
                    const SizedBox(height: 16),
                    _buildTelemetryCard(isNight, surfaceColor, textColor, secondaryTextColor),
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _buildHudHeader(bool isNight) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: isNight ? Colors.black : Colors.indigo[800],
        border: isNight ? Border(bottom: BorderSide(color: Colors.red[900]!, width: 1)) : null,
      ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(isNight ? Icons.night_shelter : Icons.wb_sunny, color: isNight ? Colors.redAccent[700] : Colors.white),
          const SizedBox(width: 12),
          Text(
            isNight ? 'NIGHT VISION OPTICS: ACTIVE' : 'DAYLIGHT MODE',
            style: TextStyle(
              color: isNight ? Colors.redAccent[700] : Colors.white,
              fontWeight: FontWeight.bold,
              letterSpacing: 2.0,
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildRouteCard(bool isNight, Color surfaceColor, Color textColor, Color secondaryColor, Color accentColor) {
    return Card(
      elevation: isNight ? 0 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isNight ? Colors.red[900]! : Colors.transparent, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                Text('CURRENT ROUTE', style: TextStyle(color: secondaryColor, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                Icon(Icons.map, color: secondaryColor),
              ],
            ),
            const SizedBox(height: 24),
            Row(
              children: [
                Icon(Icons.circle, color: accentColor, size: 16),
                const SizedBox(width: 16),
                Text('Dallas, TX', style: TextStyle(color: textColor, fontSize: 24, fontWeight: FontWeight.bold)),
              ],
            ),
            Container(
              margin: const EdgeInsets.only(left: 7),
              height: 40,
              decoration: BoxDecoration(border: Border(left: BorderSide(color: isNight ? Colors.red[900]! : Colors.grey, width: 2))),
            ),
            Row(
              children: [
                Icon(Icons.location_on, color: accentColor, size: 24),
                const SizedBox(width: 8),
                Text('Houston, TX', style: TextStyle(color: textColor, fontSize: 24, fontWeight: FontWeight.bold)),
              ],
            ),
            const SizedBox(height: 32),
            ElevatedButton(
              onPressed: () {},
              style: ElevatedButton.styleFrom(
                backgroundColor: isNight ? Colors.transparent : Colors.indigo,
                foregroundColor: isNight ? Colors.redAccent[700] : Colors.white,
                side: BorderSide(color: isNight ? Colors.redAccent[700]! : Colors.transparent),
                minimumSize: const Size(double.infinity, 48),
              ),
              child: const Text('RESUME NAVIGATION', style: TextStyle(letterSpacing: 1.5, fontWeight: FontWeight.bold)),
            )
          ],
        ),
      ),
    );
  }

  Widget _buildTelemetryCard(bool isNight, Color surfaceColor, Color textColor, Color secondaryColor) {
    return Card(
      elevation: isNight ? 0 : 2,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: BorderSide(color: isNight ? Colors.red[900]! : Colors.transparent, width: 1),
      ),
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                _buildGauge(isNight, 'SPEED', '65', 'MPH', textColor, secondaryColor),
                _buildGauge(isNight, 'RPM', '1.4k', 'RPM', textColor, secondaryColor),
                _buildGauge(isNight, 'GEAR', '10', 'AUTO', textColor, secondaryColor),
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildGauge(bool isNight, String label, String value, String unit, Color textColor, Color secondaryColor) {
    return Column(
      children: [
        Text(value, style: TextStyle(color: textColor, fontSize: 36, fontWeight: FontWeight.bold)),
        Text(unit, style: TextStyle(color: secondaryColor, fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text(label, style: TextStyle(color: secondaryColor, fontSize: 12, letterSpacing: 1.5)),
      ],
    );
  }
}
