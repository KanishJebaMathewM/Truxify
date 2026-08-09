/**
 * weatherService.js
 * 
 * A stubbed weather service to provide simulated weather forecasts
 * based on latitude/longitude for the fueling advisor.
 */

export class WeatherService {
  constructor({ logger }) {
    this.logger = logger;
  }

  /**
   * Mock weather forecast based on latitude
   * Higher latitudes (further from equator) tend to be colder.
   * For the sake of this mock:
   * lat > 40 (e.g. Northern US/Canada) -> Sub-zero temperatures (-5°C)
   * lat <= 40 -> Warmer temperatures (15°C)
   * 
   * @param {number} lat 
   * @param {number} lng 
   * @returns {Promise<Object>} Weather conditions
   */
  async getWeatherForecast(lat, lng) {
    this.logger?.debug(`[WeatherService] Fetching forecast for lat: ${lat}, lng: ${lng}`);
    
    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 50));
    
    const numLat = Number(lat);
    let tempC = 15; // default warm
    let condition = 'clear';

    if (numLat > 40 || numLat < -40) {
      tempC = -5;
      condition = 'snow';
    }

    return {
      temperature_c: tempC,
      condition,
      forecast_time: new Date().toISOString()
    };
  }
}
