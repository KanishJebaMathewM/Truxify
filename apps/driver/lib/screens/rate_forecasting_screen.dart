import 'package:flutter/material.dart';
import '../models/freight_rate_forecast_model.dart';
import '../services/rate_forecasting_service.dart';
import 'package:intl/intl.dart';

class RateForecastingScreen extends StatefulWidget {
  const RateForecastingScreen({super.key});

  @override
  State<RateForecastingScreen> createState() => _RateForecastingScreenState();
}

class _RateForecastingScreenState extends State<RateForecastingScreen> {
  final RateForecastingService _forecastingService = RateForecastingService();
  FreightLaneForecast? _currentForecast;
  bool _isLoading = true;

  final TextEditingController _originController = TextEditingController(text: 'Chicago, IL');
  final TextEditingController _destController = TextEditingController(text: 'Atlanta, GA');

  @override
  void initState() {
    super.initState();
    _fetchForecast();
  }

  void _fetchForecast() async {
    setState(() => _isLoading = true);
    final forecast = await _forecastingService.getForecastForLane(
      _originController.text, 
      _destController.text
    );
    
    if (mounted) {
      setState(() {
        _currentForecast = forecast;
        _isLoading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Spot Market Forecaster'),
        backgroundColor: Colors.indigo[900],
      ),
      backgroundColor: Colors.grey[100],
      body: Column(
        children: [
          _buildSearchHeader(),
          if (_isLoading)
            const Expanded(child: Center(child: CircularProgressIndicator()))
          else if (_currentForecast != null)
            Expanded(
              child: ListView(
                padding: const EdgeInsets.all(16),
                children: [
                  _buildMarketOverviewCard(),
                  const SizedBox(height: 16),
                  const Text('7-Day Rate Forecast', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  ..._currentForecast!.sevenDayForecast.map((daily) => _buildDailyForecastCard(daily)).toList(),
                ],
              ),
            )
        ],
      ),
    );
  }

  Widget _buildSearchHeader() {
    return Container(
      padding: const EdgeInsets.all(16),
      color: Colors.white,
      child: Column(
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: _originController,
                  decoration: const InputDecoration(labelText: 'Origin', border: OutlineInputBorder(), prefixIcon: Icon(Icons.location_on, color: Colors.indigo)),
                ),
              ),
              const SizedBox(width: 8),
              const Icon(Icons.arrow_forward),
              const SizedBox(width: 8),
              Expanded(
                child: TextField(
                  controller: _destController,
                  decoration: const InputDecoration(labelText: 'Destination', border: OutlineInputBorder(), prefixIcon: Icon(Icons.flag, color: Colors.indigo)),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              onPressed: _fetchForecast,
              style: ElevatedButton.styleFrom(backgroundColor: Colors.indigo, foregroundColor: Colors.white),
              child: const Text('GENERATE FORECAST'),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildMarketOverviewCard() {
    final f = _currentForecast!;
    return Card(
      elevation: 4,
      shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
      child: Padding(
        padding: const EdgeInsets.all(16.0),
        child: Column(
          children: [
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              children: [
                const Text('Market Condition:', style: TextStyle(color: Colors.grey, fontSize: 16)),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 4),
                  decoration: BoxDecoration(color: Colors.red[100], borderRadius: BorderRadius.circular(12)),
                  child: Text(f.marketCondition.toUpperCase(), style: TextStyle(color: Colors.red[800], fontWeight: FontWeight.bold)),
                )
              ],
            ),
            const Divider(height: 24),
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceAround,
              children: [
                Column(
                  children: [
                    Text('${f.currentLoadToTruckRatio}', style: const TextStyle(fontSize: 24, fontWeight: FontWeight.bold)),
                    const Text('Load-to-Truck Ratio', style: TextStyle(color: Colors.grey)),
                  ],
                ),
                Column(
                  children: [
                    const Text('High Volatility', style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold, color: Colors.orange)),
                    const Text('Algorithm Confidence', style: TextStyle(color: Colors.grey)),
                  ],
                )
              ],
            )
          ],
        ),
      ),
    );
  }

  Widget _buildDailyForecastCard(DailyRateForecast daily) {
    Color trendColor = daily.trend == 'Up' ? Colors.green : (daily.trend == 'Down' ? Colors.red : Colors.grey);
    IconData trendIcon = daily.trend == 'Up' ? Icons.trending_up : (daily.trend == 'Down' ? Icons.trending_down : Icons.trending_flat);

    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        leading: Container(
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(color: Colors.indigo[50], borderRadius: BorderRadius.circular(8)),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(DateFormat('MMM').format(daily.date), style: TextStyle(fontSize: 10, color: Colors.indigo[900])),
              Text(DateFormat('d').format(daily.date), style: TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Colors.indigo[900])),
            ],
          ),
        ),
        title: Row(
          children: [
            Text('\$${daily.predictedRatePerMile.toStringAsFixed(2)} / mi', style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 18)),
            const SizedBox(width: 8),
            Icon(trendIcon, color: trendColor, size: 20),
          ],
        ),
        subtitle: Text('Expected Range: \$${daily.confidenceIntervalLow.toStringAsFixed(2)} - \$${daily.confidenceIntervalHigh.toStringAsFixed(2)}'),
        trailing: daily.trend == 'Up' 
            ? ElevatedButton(
                onPressed: () {},
                style: ElevatedButton.styleFrom(backgroundColor: Colors.green, foregroundColor: Colors.white, padding: const EdgeInsets.symmetric(horizontal: 12)),
                child: const Text('WAIT & BOOK'),
              )
            : null,
      ),
    );
  }
}
