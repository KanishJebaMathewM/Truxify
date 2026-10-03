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

    // Number('abc') -> NaN; NaN comparisons are always false so a bad
    // latitude would silently fall through to the warm default. Guard it
    // explicitly so the intent is clear.
    const validLat = Number.isFinite(numLat);
    const validLng = Number.isFinite(Number(lng));

    if (!validLat || !validLng) {
      return {
        temperature_c: tempC,
        condition,
        forecast_time: new Date().toISOString()
      };
    }

    if (validLat && (numLat > 40 || numLat < -40)) {
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


// === ENTERPRISE WEATHER SERVICE EXTENSIONS (Issue #14109 Expansion) ===

/**
 * Validates whether coordinates fall within severe weather hazard zones.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {boolean} True if hazardous conditions are likely
 */
export async function checkSevereWeatherAdvisory(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);
  
  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return false;
  }
  
  // Extreme polar regions or high-altitude simulation check
  if (Math.abs(numLat) > 60) {
    return true; // Blizzard/Severe hazard warning
  }
  
  return false;
}

/**
 * Batch retrieves weather forecasts for multiple geographic coordinates concurrently.
 * 
 * @param {Array<{lat: number, lng: number}>} coordsList - List of coordinates
 * @returns {Promise<Object[]>} Array of weather forecast objects
 */
async function batchGetWeatherForecasts(coordsList) {
  if (!Array.isArray(coordsList) || coordsList.length === 0) {
    return [];
  }
  
  const forecasts = await Promise.all(
    coordsList.map(async (coord) => {
      if (!coord || typeof coord.lat === 'undefined' || typeof coord.lng === 'undefined') {
        return { error: 'Invalid coordinates provided' };
      }
      return this.getWeatherForecast(coord.lat, coord.lng);
    })
  );
  
  return forecasts;
}

// Attach batch processing to prototype for advanced enterprise fleet routing
WeatherService.prototype.batchGetWeatherForecasts = batchGetWeatherForecasts;


// === ADVANCED FLEET WEATHER & FUEL IMPACT UTILITIES (Issue #14109 Expansion) ===

/**
 * Calculates fuel consumption efficiency penalty percentage based on weather conditions and temperature.
 * Cold weather or snow increases aerodynamic drag and engine idling overhead for freight trucks.
 * 
 * @param {string} condition - Weather condition ('clear', 'snow', etc.)
 * @param {number} temperatureC - Temperature in Celsius
 * @returns {number} Fuel penalty percentage multiplier (e.g., 1.12 for 12% extra consumption)
 */
export function calculateWeatherFuelPenalty(condition, temperatureC) {
  if (typeof temperatureC !== 'number' || !Number.isFinite(temperatureC)) {
    return 1.0; // Default baseline (no penalty)
  }

  let penaltyMultiplier = 1.0;

  // Snow or sub-zero freezing conditions heavily impact heavy vehicle efficiency
  if (condition === 'snow' || temperatureC < 0) {
    penaltyMultiplier += 0.15; // 15% penalty for winter/snow
  } else if (temperatureC < 10) {
    penaltyMultiplier += 0.05; // 5% penalty for chilly weather
  } else if (temperatureC > 35) {
    penaltyMultiplier += 0.08; // 8% penalty for extreme heat (AC/cooling load)
  }

  return Number(penaltyMultiplier.toFixed(2));
}

/**
 * Validates coordinate bounding boxes for regional weather advisories.
 * 
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @returns {string} Advisory region descriptor
 */
export function getMeteorologicalRegion(lat, lng) {
  const numLat = Number(lat);
  const numLng = Number(lng);

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    return 'UNKNOWN_REGION';
  }

  if (numLat > 40) return 'NORTH_TEMPERATE_POLAR';
  if (numLat < -40) return 'SOUTH_TEMPERATE_POLAR';
  if (numLat >= -15 && numLat <= 15) return 'EQUATORIAL_TROPICAL';
  
  return 'MID_LATITUDE_ZONE';
}

// Unified export object for analytics and advisor microservices
export const WeatherAdvisorUtilities = {
  calculateWeatherFuelPenalty,
  getMeteorologicalRegion
};


// === ENTERPRISE ROUTE WEATHER RISK ASSESSMENT (Issue #14109 Expansion) ===

/**
 * Assesses overall weather risk and potential delivery delay for a freight route corridor.
 * 
 * @param {Array<{lat: number, lng: number}>} routeCoords - List of geographic waypoints along the route
 * @returns {Promise<Object>} Risk assessment summary with severity level and estimated delay factor
 */
async function assessRouteWeatherRisk(routeCoords) {
  if (!Array.isArray(routeCoords) || routeCoords.length === 0) {
    return { riskLevel: 'LOW', severeWaypointCount: 0, delayMultiplier: 1.0 };
  }

  let severeCount = 0;
  let chillyCount = 0;

  for (const coord of routeCoords) {
    if (!coord || typeof coord.lat === 'undefined' || typeof coord.lng === 'undefined') {
      continue;
    }
    
    // Check using helper logic
    const isSevere = Math.abs(coord.lat) > 60;
    if (isSevere) {
      severeCount++;
    } else if (Math.abs(coord.lat) > 40) {
      chillyCount++;
    }
  }

  let riskLevel = 'LOW';
  let delayMultiplier = 1.0;

  if (severeCount > 0) {
    riskLevel = 'SEVERE';
    delayMultiplier = 1.35; // 35% estimated delay due to blizzard/snowstorm
  } else if (chillyCount >= 2) {
    riskLevel = 'HIGH';
    delayMultiplier = 1.15; // 15% estimated delay
  } else if (chillyCount === 1) {
    riskLevel = 'MEDIUM';
    delayMultiplier = 1.08;
  }

  return {
    riskLevel,
    severeWaypointCount: severeCount,
    delayMultiplier
  };
}

// Attach route risk assessment to prototype
WeatherService.prototype.assessRouteWeatherRisk = assessRouteWeatherRisk;
