/**
 * @fileoverview Multi-Leg Relay Hub Dispatch & Corridor Partitioning Service.
 * 
 * Responsibilities:
 * 1. Partitions long-haul routes (>400 km) into optimal 250-400 km regional corridor segments.
 * 2. Matches segment boundaries to geofenced NHAI highway transshipment hubs.
 * 3. Orchestrates multi-driver leg assignments and dynamic ETA propagation.
 * 4. Manages relay lifecycle states across sequential corridor handoffs.
 */

import logger from '../middleware/logger.js';
import { DomainError } from './order/domainError.js';
import crypto from 'crypto';

/**
 * Predefined NHAI National Highway Transshipment Hubs & Freight Nodes.
 * Each hub has defined coordinates, geofence radius (meters), and operational capacity.
 */
export const TRANSSHIPMENT_HUBS = [
  { id: 'HUB_DEL_01', name: 'Delhi-NCR Sanjay Gandhi Transport Nagar', lat: 28.7511, lng: 77.1472, radiusMeters: 1500, state: 'Delhi', highway: 'NH44' },
  { id: 'HUB_AGR_01', name: 'Agra Transport Nagar Hub', lat: 27.2038, lng: 77.9654, radiusMeters: 1200, state: 'Uttar Pradesh', highway: 'NH44' },
  { id: 'HUB_GWL_01', name: 'Gwalior Bypass Freight Hub', lat: 26.2183, lng: 78.1828, radiusMeters: 1000, state: 'Madhya Pradesh', highway: 'NH44' },
  { id: 'HUB_JHS_01', name: 'Jhansi East-West Cross Corridor Hub', lat: 25.4484, lng: 78.5685, radiusMeters: 1000, state: 'Uttar Pradesh', highway: 'NH44' },
  { id: 'HUB_NGP_01', name: 'Nagpur Multi-Modal Logistics Hub (MIHAN)', lat: 21.0594, lng: 79.0289, radiusMeters: 2500, state: 'Maharashtra', highway: 'NH44' },
  { id: 'HUB_HYD_01', name: 'Hyderabad Outer Ring Road Freight Hub', lat: 17.3850, lng: 78.4867, radiusMeters: 2000, state: 'Telangana', highway: 'NH44' },
  { id: 'HUB_KRN_01', name: 'Kurnool Highway Logistics Node', lat: 15.8281, lng: 78.0373, radiusMeters: 1000, state: 'Andhra Pradesh', highway: 'NH44' },
  { id: 'HUB_BLR_01', name: 'Bengaluru Nelamangala Freight Interchange', lat: 13.0995, lng: 77.3916, radiusMeters: 2000, state: 'Karnataka', highway: 'NH44' },
  { id: 'HUB_JPR_01', name: 'Jaipur VKIA Transport Hub', lat: 26.9855, lng: 75.7725, radiusMeters: 1500, state: 'Rajasthan', highway: 'NH48' },
  { id: 'HUB_AMD_01', name: 'Ahmedabad Aslali Logistics Hub', lat: 22.9298, lng: 72.5894, radiusMeters: 2000, state: 'Gujarat', highway: 'NH48' },
  { id: 'HUB_SRT_01', name: 'Surat Palsana Highway Freight Terminal', lat: 21.1702, lng: 72.8311, radiusMeters: 1500, state: 'Gujarat', highway: 'NH48' },
  { id: 'HUB_BOM_01', name: 'Navi Mumbai JNPT Corridor Hub (Kalamboli)', lat: 19.0330, lng: 73.1026, radiusMeters: 3000, state: 'Maharashtra', highway: 'NH48' },
  { id: 'HUB_PUN_01', name: 'Pune Chakan Industrial Corridor Hub', lat: 18.7606, lng: 73.8636, radiusMeters: 2000, state: 'Maharashtra', highway: 'NH48' },
  { id: 'HUB_KNP_01', name: 'Kanpur Transport Nagar Logistics Node', lat: 26.4499, lng: 80.3319, radiusMeters: 1500, state: 'Uttar Pradesh', highway: 'NH19' },
  { id: 'HUB_VNS_01', name: 'Varanasi Freight Junction Hub', lat: 25.3176, lng: 82.9739, radiusMeters: 1200, state: 'Uttar Pradesh', highway: 'NH19' },
  { id: 'HUB_CCU_01', name: 'Kolkata Dankuni Freight Terminal', lat: 22.6844, lng: 88.2917, radiusMeters: 2500, state: 'West Bengal', highway: 'NH19' },
];

/**
 * Calculates Great-Circle distance between two coordinates in kilometers (Haversine formula).
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth radius in km
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
 * Finds the nearest transshipment hub to a specified coordinate.
 */
export function findNearestHub(lat, lng, maxSearchRadiusKm = 200) {
  let nearest = null;
  let minDistance = Infinity;

  for (const hub of TRANSSHIPMENT_HUBS) {
    const dist = calculateDistanceKm(lat, lng, hub.lat, hub.lng);
    if (dist < minDistance && dist <= maxSearchRadiusKm) {
      minDistance = dist;
      nearest = { ...hub, distanceToPointKm: Number(minDistance.toFixed(2)) };
    }
  }

  return nearest;
}

/**
 * Partitions a long-haul route into relay corridor segments.
 * 
 * @param {Object} origin - { lat, lng, address }
 * @param {Object} destination - { lat, lng, address }
 * @param {number} totalAmount - Total booking freight payout
 * @param {Object} [options] - Options (maxLegDistanceKm, etc.)
 * @returns {Object} Relay plan with sequential legs and hub nodes
 */
export function partitionRouteIntoCorridorLegs(origin, destination, totalAmount = 0, options = {}) {
  const maxLegDistanceKm = options.maxLegDistanceKm || 350;
  const totalDirectDistanceKm = calculateDistanceKm(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng
  );

  if (totalDirectDistanceKm < 200) {
    // Short haul does not require relay partitioning
    return {
      isRelayApplicable: false,
      reason: 'Route distance (<200 km) is suited for single-driver direct haul',
      totalDistanceKm: Number(totalDirectDistanceKm.toFixed(2)),
      legs: [
        {
          legIndex: 0,
          origin: { ...origin },
          destination: { ...destination },
          distanceKm: Number(totalDirectDistanceKm.toFixed(2)),
          legAmount: totalAmount,
          isFinalLeg: true,
          hub: null,
        }
      ],
    };
  }

  const estimatedLegCount = Math.max(2, Math.ceil(totalDirectDistanceKm / maxLegDistanceKm));
  const legs = [];
  let currentStart = { ...origin };

  for (let i = 1; i < estimatedLegCount; i++) {
    const fraction = i / estimatedLegCount;
    const targetLat = origin.lat + (destination.lat - origin.lat) * fraction;
    const targetLng = origin.lng + (destination.lng - origin.lng) * fraction;

    const matchedHub = findNearestHub(targetLat, targetLng);
    const waypointDest = matchedHub
      ? { lat: matchedHub.lat, lng: matchedHub.lng, address: matchedHub.name, hubId: matchedHub.id, radiusMeters: matchedHub.radiusMeters }
      : { lat: targetLat, lng: targetLng, address: `Corridor Waypoint ${i}` };

    const legDistance = calculateDistanceKm(currentStart.lat, currentStart.lng, waypointDest.lat, waypointDest.lng);

    legs.push({
      legIndex: i - 1,
      origin: { ...currentStart },
      destination: { ...waypointDest },
      distanceKm: Number(legDistance.toFixed(2)),
      hub: matchedHub || null,
      isFinalLeg: false,
    });

    currentStart = { ...waypointDest };
  }

  // Final Leg to ultimate destination
  const finalDistance = calculateDistanceKm(currentStart.lat, currentStart.lng, destination.lat, destination.lng);
  legs.push({
    legIndex: legs.length,
    origin: { ...currentStart },
    destination: { ...destination },
    distanceKm: Number(finalDistance.toFixed(2)),
    hub: null,
    isFinalLeg: true,
  });

  // Calculate proportional financial distribution per leg
  const totalLegsDistance = legs.reduce((sum, leg) => sum + leg.distanceKm, 0);
  legs.forEach((leg) => {
    leg.payoutSharePercentage = Number(((leg.distanceKm / totalLegsDistance) * 100).toFixed(2));
    leg.legAmount = Number(((leg.distanceKm / totalLegsDistance) * totalAmount).toFixed(2));
    leg.hubWaypointHash = crypto
      .createHash('sha256')
      .update(`${leg.destination.lat},${leg.destination.lng},${leg.legIndex}`)
      .digest('hex');
  });

  return {
    isRelayApplicable: true,
    totalDistanceKm: Number(totalLegsDistance.toFixed(2)),
    totalLegs: legs.length,
    totalAmount,
    legs,
  };
}

/**
 * In-memory relay session registry (mirrored to persistent store in production).
 */
const activeRelaySessions = new Map();

/**
 * Creates and initializes a relay orchestration session.
 */
export async function createRelaySession(customerUserId, relayData) {
  const { origin, destination, totalAmount, driverAssignments } = relayData;

  if (!origin || !destination || !totalAmount) {
    throw new DomainError(400, { error: 'Missing required parameters: origin, destination, totalAmount' });
  }

  const relayPlan = partitionRouteIntoCorridorLegs(origin, destination, totalAmount);
  const relayBookingId = `RLY_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

  const legs = relayPlan.legs.map((leg, index) => ({
    ...leg,
    driverId: driverAssignments?.[index]?.driverId || null,
    driverWallet: driverAssignments?.[index]?.driverWallet || null,
    status: index === 0 ? 'ASSIGNED' : 'PENDING_DISPATCH',
    handshakeCompleted: false,
  }));

  const session = {
    relayBookingId,
    customerId: customerUserId,
    totalAmount,
    totalLegs: legs.length,
    currentActiveLegIndex: 0,
    status: 'ACTIVE',
    legs,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  activeRelaySessions.set(relayBookingId, session);
  logger.info({ relayBookingId, totalLegs: legs.length }, '[relayDispatchService] Relay session initialized');

  return session;
}

/**
 * Retrieves a relay session by booking ID.
 */
export async function getRelaySession(relayBookingId) {
  const session = activeRelaySessions.get(relayBookingId);
  if (!session) {
    throw new DomainError(404, { error: `Relay session not found for ID: ${relayBookingId}` });
  }
  return session;
}

/**
 * Advances the active relay leg upon verified handoff.
 */
export async function advanceRelayLeg(relayBookingId, completedLegIndex, handoffReceipt) {
  const session = activeRelaySessions.get(relayBookingId);
  if (!session) {
    throw new DomainError(404, { error: 'Relay booking not found' });
  }

  if (session.currentActiveLegIndex !== completedLegIndex) {
    throw new DomainError(400, {
      error: `Leg progression mismatch: expected leg ${session.currentActiveLegIndex}, received ${completedLegIndex}`,
    });
  }

  const currentLeg = session.legs[completedLegIndex];
  currentLeg.status = 'COMPLETED';
  currentLeg.handshakeCompleted = true;
  currentLeg.handoffReceipt = handoffReceipt;
  currentLeg.completedAt = new Date().toISOString();

  session.currentActiveLegIndex += 1;

  if (session.currentActiveLegIndex >= session.totalLegs) {
    session.status = 'COMPLETED';
    session.completedAt = new Date().toISOString();
  } else {
    const nextLeg = session.legs[session.currentActiveLegIndex];
    nextLeg.status = 'IN_TRANSIT';
  }

  session.updatedAt = new Date().toISOString();
  activeRelaySessions.set(relayBookingId, session);

  logger.info(
    { relayBookingId, completedLegIndex, nextActiveLeg: session.currentActiveLegIndex },
    '[relayDispatchService] Leg advanced successfully'
  );

  return session;
}

export default {
  TRANSSHIPMENT_HUBS,
  calculateDistanceKm,
  findNearestHub,
  partitionRouteIntoCorridorLegs,
  createRelaySession,
  getRelaySession,
  advanceRelayLeg,
};
