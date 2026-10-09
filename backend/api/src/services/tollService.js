/**
 * @fileoverview Indian National Highway (NHAI / NPCI) Toll Plaza Registry & Route Estimator Engine.
 * 
 * Responsibilities:
 * 1. Maintains registry of NHAI toll plazas across major national highways (NH44, NH48, NH19, NH16, NH27, etc.).
 * 2. Implements vehicle-class-specific fee schedules (LCV, 2-Axle, 3-Axle, 4-6 Axle MAV, 7+ Axle HCM/EME).
 * 3. Intercepts route geometries with toll plaza geofences to compute exact toll fees along a transit route.
 */

import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';

/**
 * Commercial Vehicle Classifications according to NHAI Toll Regulations.
 */
export const VEHICLE_AXLE_CLASSES = {
  LCV: { id: 'LCV', label: 'Light Commercial Vehicle / Mini-Truck (e.g., Tata Ace, Bolero Maxi)', rateMultiplier: 1.0 },
  '2_AXLE_TRUCK': { id: '2_AXLE_TRUCK', label: '2-Axle Truck / Commercial Bus', rateMultiplier: 1.6 },
  '3_AXLE_TRUCK': { id: '3_AXLE_TRUCK', label: '3-Axle Commercial Vehicle', rateMultiplier: 2.1 },
  '4_6_AXLE_MAV': { id: '4_6_AXLE_MAV', label: '4 to 6-Axle Multi-Axle Vehicle (MAV) / Semi-Trailer', rateMultiplier: 2.8 },
  '7_AXLE_OVERSIZED': { id: '7_AXLE_OVERSIZED', label: '7+ Axle Heavy Construction Machinery / Over Dimensional Cargo', rateMultiplier: 3.5 },
};

/**
 * NHAI / NPCI National Highway Toll Plaza Registry.
 */
export const NHAI_TOLL_PLAZAS = [
  // NH44 Corridor (North-South: Delhi -> Bangalore)
  { id: 'TP_NH44_MURTHAL', name: 'Murthal Toll Plaza', highway: 'NH44', state: 'Haryana', lat: 29.0305, lng: 77.0722, baseRateInr: 105, radiusMeters: 2000 },
  { id: 'TP_NH44_KARNAL', name: 'Gharaunda (Karnal) Toll Plaza', highway: 'NH44', state: 'Haryana', lat: 29.5441, lng: 76.9712, baseRateInr: 155, radiusMeters: 2000 },
  { id: 'TP_NH44_PALWAL', name: 'Palwal Toll Plaza', highway: 'NH44', state: 'Haryana', lat: 28.1487, lng: 77.3320, baseRateInr: 130, radiusMeters: 2000 },
  { id: 'TP_NH44_MATHURA', name: 'Mathura (Madhuban) Toll Plaza', highway: 'NH44', state: 'Uttar Pradesh', lat: 27.5706, lng: 77.6200, baseRateInr: 175, radiusMeters: 2000 },
  { id: 'TP_NH44_GWALIOR', name: 'Morena-Gwalior Toll Plaza', highway: 'NH44', state: 'Madhya Pradesh', lat: 26.4998, lng: 77.9944, baseRateInr: 120, radiusMeters: 2000 },
  { id: 'TP_NH44_BABINA', name: 'Babina Toll Plaza', highway: 'NH44', state: 'Uttar Pradesh', lat: 25.2415, lng: 78.4720, baseRateInr: 110, radiusMeters: 2000 },
  { id: 'TP_NH44_NAGPUR_N', name: 'Kelod Toll Plaza', highway: 'NH44', state: 'Maharashtra', lat: 21.4645, lng: 78.8789, baseRateInr: 140, radiusMeters: 2000 },
  { id: 'TP_NH44_NAGPUR_S', name: 'Bori (Nagpur) Toll Plaza', highway: 'NH44', state: 'Maharashtra', lat: 20.9102, lng: 78.9950, baseRateInr: 135, radiusMeters: 2000 },
  { id: 'TP_NH44_ADILABAD', name: 'Piprawada Toll Plaza', highway: 'NH44', state: 'Telangana', lat: 19.7891, lng: 78.5340, baseRateInr: 125, radiusMeters: 2000 },
  { id: 'TP_NH44_HYD_N', name: 'Manoharabad Toll Plaza', highway: 'NH44', state: 'Telangana', lat: 17.7844, lng: 78.4410, baseRateInr: 115, radiusMeters: 2000 },
  { id: 'TP_NH44_HYD_S', name: 'Raikal Toll Plaza', highway: 'NH44', state: 'Telangana', lat: 16.9850, lng: 78.2312, baseRateInr: 120, radiusMeters: 2000 },
  { id: 'TP_NH44_KURNOOL', name: 'Pullur Toll Plaza', highway: 'NH44', state: 'Andhra Pradesh', lat: 15.8920, lng: 77.9890, baseRateInr: 130, radiusMeters: 2000 },
  { id: 'TP_NH44_ANANTAPUR', name: 'Marur Toll Plaza', highway: 'NH44', state: 'Andhra Pradesh', lat: 14.5901, lng: 77.5810, baseRateInr: 140, radiusMeters: 2000 },
  { id: 'TP_NH44_BLR_N', name: 'Bagepalli Toll Plaza', highway: 'NH44', state: 'Karnataka', lat: 13.7840, lng: 77.7920, baseRateInr: 110, radiusMeters: 2000 },

  // NH48 Corridor (Delhi -> Mumbai -> Bangalore)
  { id: 'TP_NH48_KHERKI', name: 'Kherki Daula Toll Plaza', highway: 'NH48', state: 'Haryana', lat: 28.3980, lng: 76.9820, baseRateInr: 80, radiusMeters: 2000 },
  { id: 'TP_NH48_SHAHJAHANPUR', name: 'Shahjahanpur Toll Plaza', highway: 'NH48', state: 'Rajasthan', lat: 27.9940, lng: 76.5410, baseRateInr: 195, radiusMeters: 2000 },
  { id: 'TP_NH48_MANOHARPUR', name: 'Manoharpur Toll Plaza', highway: 'NH48', state: 'Rajasthan', lat: 27.2910, lng: 75.9410, baseRateInr: 125, radiusMeters: 2000 },
  { id: 'TP_NH48_KISHANGARH', name: 'Kishangarh Toll Plaza', highway: 'NH48', state: 'Rajasthan', lat: 26.6120, lng: 74.8910, baseRateInr: 150, radiusMeters: 2000 },
  { id: 'TP_NH48_BHILWARA', name: 'Rupaheli Toll Plaza', highway: 'NH48', state: 'Rajasthan', lat: 25.6890, lng: 74.7210, baseRateInr: 135, radiusMeters: 2000 },
  { id: 'TP_NH48_AHMEDABAD_NE', name: 'Kathwada Toll Plaza', highway: 'NH48', state: 'Gujarat', lat: 23.0510, lng: 72.6990, baseRateInr: 110, radiusMeters: 2000 },
  { id: 'TP_NH48_VADODARA', name: 'Vasad Toll Plaza', highway: 'NH48', state: 'Gujarat', lat: 22.4610, lng: 73.0720, baseRateInr: 165, radiusMeters: 2000 },
  { id: 'TP_NH48_SURAT', name: 'Bhestan / Boriach Toll Plaza', highway: 'NH48', state: 'Gujarat', lat: 21.0910, lng: 72.8940, baseRateInr: 145, radiusMeters: 2000 },
  { id: 'TP_NH48_MUMBAI_ENTRY', name: 'Charoti Toll Plaza', highway: 'NH48', state: 'Maharashtra', lat: 19.8710, lng: 72.8910, baseRateInr: 180, radiusMeters: 2000 },
  { id: 'TP_NH48_KHALAPUR', name: 'Khalapur Toll Plaza (Mumbai-Pune Exp)', highway: 'NH48', state: 'Maharashtra', lat: 18.7910, lng: 73.2910, baseRateInr: 320, radiusMeters: 2500 },
  { id: 'TP_NH48_TALEGAON', name: 'Talegaon Toll Plaza (Mumbai-Pune Exp)', highway: 'NH48', state: 'Maharashtra', lat: 18.7210, lng: 73.6810, baseRateInr: 220, radiusMeters: 2500 },
  { id: 'TP_NH48_KAGAL', name: 'Kagal Toll Plaza (Kolhapur)', highway: 'NH48', state: 'Maharashtra', lat: 16.5810, lng: 74.3210, baseRateInr: 125, radiusMeters: 2000 },
  { id: 'TP_NH48_BELGAUM', name: 'Hattargi Toll Plaza', highway: 'NH48', state: 'Karnataka', lat: 16.1410, lng: 74.4920, baseRateInr: 115, radiusMeters: 2000 },

  // NH19 Corridor (Delhi -> Kolkata)
  { id: 'TP_NH19_SIKANDRA', name: 'Sikandra Toll Plaza (Agra)', highway: 'NH19', state: 'Uttar Pradesh', lat: 27.2410, lng: 77.9120, baseRateInr: 120, radiusMeters: 2000 },
  { id: 'TP_NH19_ETAWAH', name: 'Anantram Toll Plaza', highway: 'NH19', state: 'Uttar Pradesh', lat: 26.6810, lng: 79.2810, baseRateInr: 145, radiusMeters: 2000 },
  { id: 'TP_NH19_KANPUR', name: 'Barajodhi Toll Plaza', highway: 'NH19', state: 'Uttar Pradesh', lat: 26.3110, lng: 80.4910, baseRateInr: 130, radiusMeters: 2000 },
  { id: 'TP_NH19_PRAYAGRAJ', name: 'KokHraj Toll Plaza', highway: 'NH19', state: 'Uttar Pradesh', lat: 25.5910, lng: 81.5410, baseRateInr: 140, radiusMeters: 2000 },
  { id: 'TP_NH19_VARANASI', name: 'Dafi Toll Plaza', highway: 'NH19', state: 'Uttar Pradesh', lat: 25.2610, lng: 82.9410, baseRateInr: 115, radiusMeters: 2000 },
  { id: 'TP_NH19_SASARAM', name: 'Sasaram Toll Plaza', highway: 'NH19', state: 'Bihar', lat: 24.9510, lng: 83.9910, baseRateInr: 150, radiusMeters: 2000 },
  { id: 'TP_NH19_DHANBAD', name: 'Govindpur Toll Plaza', highway: 'NH19', state: 'Jharkhand', lat: 23.8310, lng: 86.5210, baseRateInr: 125, radiusMeters: 2000 },
  { id: 'TP_NH19_DANKUNI', name: 'Dankuni Toll Plaza', highway: 'NH19', state: 'West Bengal', lat: 22.6910, lng: 88.2710, baseRateInr: 110, radiusMeters: 2000 },
];

/**
 * Calculates Great-Circle distance between two points in km.
 */
function getDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Calculates perpendicular distance from a point to a route segment (cross-track distance).
 */
function distancePointToSegmentKm(pLat, pLng, aLat, aLng, bLat, bLng) {
  const lineDist = getDistanceKm(aLat, aLng, bLat, bLng);
  if (lineDist === 0) return getDistanceKm(pLat, pLng, aLat, aLng);

  // Vector projections in equirectangular projection approximation
  const dLat = bLat - aLat;
  const dLng = bLng - aLng;
  const t = Math.max(0, Math.min(1, ((pLat - aLat) * dLat + (pLng - aLng) * dLng) / (dLat * dLat + dLng * dLng)));

  const projLat = aLat + t * dLat;
  const projLng = aLng + t * dLng;

  return getDistanceKm(pLat, pLng, projLat, projLng);
}

/**
 * Computes toll plaza fees for a specific vehicle axle class.
 */
export function calculatePlazaFee(plaza, vehicleClass = '2_AXLE_TRUCK') {
  const axleConfig = VEHICLE_AXLE_CLASSES[vehicleClass] || VEHICLE_AXLE_CLASSES['2_AXLE_TRUCK'];
  const baseRate = plaza.baseRateInr || 100;
  const computedFee = Math.round(baseRate * axleConfig.rateMultiplier);

  return {
    plazaId: plaza.id,
    plazaName: plaza.name,
    highway: plaza.highway,
    state: plaza.state,
    lat: plaza.lat,
    lng: plaza.lng,
    vehicleClass: axleConfig.id,
    vehicleClassLabel: axleConfig.label,
    feeInr: computedFee,
  };
}

/**
 * Estimates toll costs by intercepting route points with the NHAI Toll Plaza Registry.
 * 
 * @param {Object} origin - { lat, lng }
 * @param {Object} destination - { lat, lng }
 * @param {string} [vehicleClass='2_AXLE_TRUCK'] - Commercial vehicle class
 * @param {Array<Object>} [waypoints=[]] - Optional intermediate route waypoints
 * @returns {Object} Toll estimate breakdown with crossed plazas and total INR amount
 */
export function estimateRouteTolls(origin, destination, vehicleClass = '2_AXLE_TRUCK', waypoints = []) {
  if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
    throw new DomainError(400, { error: 'Valid origin and destination coordinates are required' });
  }

  const routePoints = [origin, ...(Array.isArray(waypoints) ? waypoints : []), destination];
  const detectedPlazas = new Map();
  const maxPlazaBufferKm = 12; // Maximum corridor buffer radius around highway centerline

  for (let i = 0; i < routePoints.length - 1; i++) {
    const ptA = routePoints[i];
    const ptB = routePoints[i + 1];

    for (const plaza of NHAI_TOLL_PLAZAS) {
      if (detectedPlazas.has(plaza.id)) continue;

      const crossTrackDist = distancePointToSegmentKm(
        plaza.lat,
        plaza.lng,
        ptA.lat,
        ptA.lng,
        ptB.lat,
        ptB.lng
      );

      if (crossTrackDist <= maxPlazaBufferKm) {
        // Confirm plaza is between segment bounding box (with buffer)
        const minLat = Math.min(ptA.lat, ptB.lat) - 0.15;
        const maxLat = Math.max(ptA.lat, ptB.lat) + 0.15;
        const minLng = Math.min(ptA.lng, ptB.lng) - 0.15;
        const maxLng = Math.max(ptA.lng, ptB.lng) + 0.15;

        if (plaza.lat >= minLat && plaza.lat <= maxLat && plaza.lng >= minLng && plaza.lng <= maxLng) {
          const plazaFeeInfo = calculatePlazaFee(plaza, vehicleClass);
          detectedPlazas.set(plaza.id, plazaFeeInfo);
        }
      }
    }
  }

  const plazaList = Array.from(detectedPlazas.values());
  const totalTollAmountInr = plazaList.reduce((sum, p) => sum + p.feeInr, 0);

  logger.info(
    { origin, destination, vehicleClass, tollPlazasCount: plazaList.length, totalTollAmountInr },
    '[tollService] Toll estimate computed'
  );

  return {
    success: true,
    vehicleClass,
    vehicleClassDetails: VEHICLE_AXLE_CLASSES[vehicleClass] || VEHICLE_AXLE_CLASSES['2_AXLE_TRUCK'],
    totalPlazasCrossed: plazaList.length,
    totalTollEstimateInr: totalTollAmountInr,
    plazas: plazaList,
  };
}

/**
 * Returns list of registered NHAI toll plazas.
 */
export function listAllPlazas(highwayFilter = null) {
  if (highwayFilter) {
    return NHAI_TOLL_PLAZAS.filter((p) => p.highway.toLowerCase() === highwayFilter.toLowerCase());
  }
  return NHAI_TOLL_PLAZAS;
}

export default {
  VEHICLE_AXLE_CLASSES,
  NHAI_TOLL_PLAZAS,
  calculatePlazaFee,
  estimateRouteTolls,
  listAllPlazas,
};
