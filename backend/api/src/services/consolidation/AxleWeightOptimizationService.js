import logger from '../../middleware/logger.js';

/**
 * Statutory Central Motor Vehicles Rules (CMVR) Axle Load Limits (in kilograms)
 * As codified under the Motor Vehicles Act / CMVR 1989 (and statutory notifications).
 */
export const CMVR_AXLE_LIMITS_KG = Object.freeze({
  STEER_AXLE: 6500,     // 6.5 Tonnes statutory front steer axle limit
  SINGLE_DRIVE: 11500,  // 11.5 Tonnes single drive axle limit
  TANDEM_BOGIE: 19000,  // 19.0 Tonnes tandem axle bogie group limit
  TRIDEM_BOGIE: 27000,  // 27.0 Tonnes tridem axle bogie group limit
  GROSS_VEHICLE_WEIGHT_MAX: 49000, // Standard 5-axle articulated vehicle
});

export const CMVR_SAFETY_THRESHOLDS = Object.freeze({
  MIN_STEER_AXLE_RATIO: 0.20, // Front steer axle must retain at least 20% of GVW for braking/steering control
  MAX_STEER_AXLE_RATIO: 0.40, // Excessive front loading impairs handling
  MAX_COG_DEVIATION_PERCENT: 15.0, // Center of Gravity should not deviate >15% from optimal envelope
  DEFAULT_DIESEL_PRICE_PER_LITER: 90.0, // INR per liter (or USD equivalent ~1.10)
  DEFAULT_DRIVER_HOURLY_RATE: 250.0, // Hourly detour wage
  BASE_CONSUMPTION_L_PER_100KM: 28.0, // Baseline empty truck diesel consumption
});

/**
 * Standard default truck geometry and tare parameters (in meters and kg).
 */
export const DEFAULT_TRUCK_SPEC = Object.freeze({
  wheelbaseLengthMeters: 6.5,    // Distance between steer axle and rear bogie center (L_wheelbase)
  bogieDistanceMeters: 6.5,       // Position of rear bogie center from front datum (d_bogie)
  trailerLengthMeters: 9.75,      // ~32ft standard container/box trailer length
  trailerWidthMeters: 2.44,       // Standard internal trailer width
  trailerHeightMeters: 2.60,      // Standard internal trailer height
  tareSteerWeightKg: 3400,        // Unladen front axle tare weight
  tareBogieWeightKg: 4200,        // Unladen rear bogie tare weight
  maxPayloadCapacityKg: 24000,    // Total gross payload rating
  steerAxleLimitKg: CMVR_AXLE_LIMITS_KG.STEER_AXLE,
  bogieAxleLimitKg: CMVR_AXLE_LIMITS_KG.TANDEM_BOGIE,
  fuelPricePerLiter: CMVR_SAFETY_THRESHOLDS.DEFAULT_DIESEL_PRICE_PER_LITER,
});

/**
 * Calculates beam-moment static load distribution across steer and rear bogie axles.
 *
 * Implements statutory mechanical statics:
 * W_steer = W_tare_steer + sum( (d_bogie - x_i) / L_wheelbase * w_i )
 * W_bogie = W_tare_bogie + sum( (x_i - x_steer) / L_wheelbase * w_i )
 *
 * @param {object} truckSpec - Physical dimensions and tare weights
 * @param {Array<object>} placedCargo - Array of { weightKg, xPositionMeters, lengthMeters }
 * @returns {object} Comprehensive axle weight statics and CMVR compliance report
 */
export function calculateAxleWeightDistribution(truckSpec = {}, placedCargo = []) {
  const spec = { ...DEFAULT_TRUCK_SPEC, ...truckSpec };
  const L = spec.wheelbaseLengthMeters || 6.5;
  const dBogie = spec.bogieDistanceMeters || L;
  const tareSteer = spec.tareSteerWeightKg || 3400;
  const tareBogie = spec.tareBogieWeightKg || 4200;
  const steerLimit = spec.steerAxleLimitKg || CMVR_AXLE_LIMITS_KG.STEER_AXLE;
  const bogieLimit = spec.bogieAxleLimitKg || CMVR_AXLE_LIMITS_KG.TANDEM_BOGIE;

  let totalCargoWeightKg = 0;
  let cargoSteerMomentSum = 0;
  let cargoBogieMomentSum = 0;
  let totalMomentAboutDatum = tareBogie * dBogie;

  for (const item of placedCargo) {
    const w = Number(item.weightKg) || 0;
    if (w <= 0) continue;

    // Item center of gravity along longitudinal axis (X)
    const xCenter = item.xPositionMeters !== undefined
      ? Number(item.xPositionMeters)
      : (Number(item.xStartMeters || 0) + (Number(item.lengthMeters || 0) / 2));

    totalCargoWeightKg += w;
    cargoSteerMomentSum += ((dBogie - xCenter) / L) * w;
    cargoBogieMomentSum += (xCenter / L) * w;
    totalMomentAboutDatum += w * xCenter;
  }

  const grossVehicleWeightKg = tareSteer + tareBogie + totalCargoWeightKg;
  const computedSteerAxleKg = tareSteer + cargoSteerMomentSum;
  const computedBogieAxleKg = tareBogie + cargoBogieMomentSum;

  // Longitudinal Center of Gravity (CoG) position from front datum
  const centerOfGravityXMeters = grossVehicleWeightKg > 0
    ? totalMomentAboutDatum / grossVehicleWeightKg
    : (dBogie / 2);

  // Steer axle ratio for steering traction validation
  const steerRatio = grossVehicleWeightKg > 0 ? (computedSteerAxleKg / grossVehicleWeightKg) : 0;
  const steerUnderloaded = steerRatio < CMVR_SAFETY_THRESHOLDS.MIN_STEER_AXLE_RATIO;
  const steerOverloaded = computedSteerAxleKg > steerLimit;
  const bogieOverloaded = computedBogieAxleKg > bogieLimit;

  // CMVR compliance violations audit
  const violations = [];
  if (steerOverloaded) {
    violations.push({
      code: 'CMVR_STEER_AXLE_OVERLOAD',
      message: `Front steer axle load (${computedSteerAxleKg.toFixed(1)} kg) exceeds statutory CMVR limit of ${steerLimit} kg by ${(computedSteerAxleKg - steerLimit).toFixed(1)} kg.`,
      actualKg: computedSteerAxleKg,
      limitKg: steerLimit,
    });
  }

  if (bogieOverloaded) {
    violations.push({
      code: 'CMVR_BOGIE_AXLE_OVERLOAD',
      message: `Rear tandem bogie load (${computedBogieAxleKg.toFixed(1)} kg) exceeds statutory CMVR limit of ${bogieLimit} kg by ${(computedBogieAxleKg - bogieLimit).toFixed(1)} kg.`,
      actualKg: computedBogieAxleKg,
      limitKg: bogieLimit,
    });
  }

  if (steerUnderloaded) {
    violations.push({
      code: 'CMVR_STEER_AXLE_UNDERLOAD_TRACTION_LOSS',
      message: `Steer axle weight ratio (${(steerRatio * 100).toFixed(1)}%) is below statutory minimum (${(CMVR_SAFETY_THRESHOLDS.MIN_STEER_AXLE_RATIO * 100).toFixed(0)}%). High risk of steering loss and understeer.`,
      actualRatio: steerRatio,
      minRatio: CMVR_SAFETY_THRESHOLDS.MIN_STEER_AXLE_RATIO,
    });
  }

  const compliant = violations.length === 0;

  return {
    compliant,
    grossVehicleWeightKg: parseFloat(grossVehicleWeightKg.toFixed(2)),
    totalCargoWeightKg: parseFloat(totalCargoWeightKg.toFixed(2)),
    steerAxle: {
      weightKg: parseFloat(computedSteerAxleKg.toFixed(2)),
      limitKg: steerLimit,
      utilizationPercentage: parseFloat(((computedSteerAxleKg / steerLimit) * 100).toFixed(1)),
      ratioOfGvw: parseFloat((steerRatio * 100).toFixed(1)),
      isOverloaded: steerOverloaded,
      isUnderloaded: steerUnderloaded,
    },
    bogieAxle: {
      weightKg: parseFloat(computedBogieAxleKg.toFixed(2)),
      limitKg: bogieLimit,
      utilizationPercentage: parseFloat(((computedBogieAxleKg / bogieLimit) * 100).toFixed(1)),
      isOverloaded: bogieOverloaded,
    },
    centerOfGravity: {
      longitudinalMeters: parseFloat(centerOfGravityXMeters.toFixed(3)),
      relativeToBogieMeters: parseFloat((dBogie - centerOfGravityXMeters).toFixed(3)),
    },
    violations,
  };
}

/**
 * 3D Bin Packing with Orientation Rules & Topological Last-In-First-Out (LIFO) Drop Sequencing.
 *
 * Prevents "trapped cargo" where early delivery stops are obstructed by later drops.
 * For a rear-loading box trailer (door at x = L):
 *   - Stop 1 (first drop) must be closest to the rear door (highest x).
 *   - Stop K (last drop) must be placed deepest in the trailer (lowest x, towards front bulkhead x = 0).
 *
 * @param {object} trailerSpec - Dimensions { lengthMeters, widthMeters, heightMeters }
 * @param {Array<object>} cargoItems - Array of { id, lengthMeters, widthMeters, heightMeters, weightKg, dropStopSequence, allowRotation }
 * @returns {object} Packing plan with 3D positions, orientations, and LIFO verification
 */
export function pack3dLifoCargo(trailerSpec = {}, cargoItems = []) {
  const trailer = {
    lengthMeters: trailerSpec.lengthMeters || DEFAULT_TRUCK_SPEC.trailerLengthMeters,
    widthMeters: trailerSpec.widthMeters || DEFAULT_TRUCK_SPEC.trailerWidthMeters,
    heightMeters: trailerSpec.heightMeters || DEFAULT_TRUCK_SPEC.trailerHeightMeters,
  };

  if (!Array.isArray(cargoItems) || cargoItems.length === 0) {
    return {
      success: true,
      packedCount: 0,
      unpackedCount: 0,
      packedItems: [],
      unpackedItems: [],
      volumetricUtilizationPercentage: 0,
      lifoCompliant: true,
    };
  }

  // Group items by dropStopSequence in descending order (highest drop stop packed first at bulkhead x=0)
  const sortedItems = [...cargoItems].sort((a, b) => {
    const stopDiff = (b.dropStopSequence || 1) - (a.dropStopSequence || 1);
    if (stopDiff !== 0) return stopDiff;
    // Secondary sort: larger volume first to pack tighter
    const volA = (a.lengthMeters || 1) * (a.widthMeters || 1) * (a.heightMeters || 1);
    const volB = (b.lengthMeters || 1) * (b.widthMeters || 1) * (b.heightMeters || 1);
    return volB - volA;
  });

  const packedItems = [];
  const unpackedItems = [];
  const totalTrailerVolume = trailer.lengthMeters * trailer.widthMeters * trailer.heightMeters;
  let packedVolume = 0;

  // Collision detection helper between two 3D bounding boxes
  const boxesIntersect = (b1, b2) => {
    const buffer = 0.001; // 1mm clearance
    return (
      b1.x + b1.l - buffer > b2.x &&
      b1.x < b2.x + b2.l - buffer &&
      b1.y + b1.w - buffer > b2.y &&
      b1.y < b2.y + b2.w - buffer &&
      b1.z + b1.h - buffer > b2.z &&
      b1.z < b2.z + b2.h - buffer
    );
  };

  for (const item of sortedItems) {
    const rawL = Number(item.lengthMeters) || 1.0;
    const rawW = Number(item.widthMeters) || 1.0;
    const rawH = Number(item.heightMeters) || 1.0;
    const allowRotation = item.allowRotation !== false; // Default allows yaw horizontal rotation

    const orientations = [
      { l: rawL, w: rawW, h: rawH, rotated: false },
    ];
    if (allowRotation && rawL !== rawW) {
      orientations.push({ l: rawW, w: rawL, h: rawH, rotated: true });
    }

    let placed = false;

    // Grid step for coordinate placement (10cm increments for high precision)
    const step = 0.10;

    for (const orient of orientations) {
      if (
        orient.l > trailer.lengthMeters ||
        orient.w > trailer.widthMeters ||
        orient.h > trailer.heightMeters
      ) {
        continue;
      }

      // Search from front (x=0) to rear (x=L), left to right, bottom to top
      for (let x = 0; x + orient.l <= trailer.lengthMeters + 0.01; x += step) {
        for (let y = 0; y + orient.w <= trailer.widthMeters + 0.01; y += step) {
          for (let z = 0; z + orient.h <= trailer.heightMeters + 0.01; z += step) {
            const candidateBox = { x, y, z, l: orient.l, w: orient.w, h: orient.h };

            // Check collision with all existing packed items
            const collision = packedItems.some(p => boxesIntersect(candidateBox, {
              x: p.position.xMeters,
              y: p.position.yMeters,
              z: p.position.zMeters,
              l: p.dimensions.lengthMeters,
              w: p.dimensions.widthMeters,
              h: p.dimensions.heightMeters,
            }));

            if (!collision) {
              // Placed successfully!
              const packedEntry = {
                id: item.id,
                dropStopSequence: item.dropStopSequence || 1,
                weightKg: Number(item.weightKg) || 0,
                dimensions: {
                  lengthMeters: parseFloat(orient.l.toFixed(2)),
                  widthMeters: parseFloat(orient.w.toFixed(2)),
                  heightMeters: parseFloat(orient.h.toFixed(2)),
                  isRotated: orient.rotated,
                },
                position: {
                  xMeters: parseFloat(x.toFixed(2)),
                  yMeters: parseFloat(y.toFixed(2)),
                  zMeters: parseFloat(z.toFixed(2)),
                  xCenterMeters: parseFloat((x + (orient.l / 2)).toFixed(2)),
                },
              };

              packedItems.push(packedEntry);
              packedVolume += orient.l * orient.w * orient.h;
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        if (placed) break;
      }
      if (placed) break;
    }

    if (!placed) {
      unpackedItems.push({
        id: item.id,
        dropStopSequence: item.dropStopSequence,
        reason: 'VOLUME_OR_DIMENSION_LIMIT_EXCEEDED',
      });
    }
  }

  // Verify Topological LIFO ordering:
  // For any item A (earlier stop) and B (later stop), A's extraction corridor to rear door (x=L)
  // must not be completely obstructed by B.
  const lifoViolations = [];
  for (let i = 0; i < packedItems.length; i++) {
    for (let j = 0; j < packedItems.length; j++) {
      if (i === j) continue;
      const itemA = packedItems[i]; // earlier stop
      const itemB = packedItems[j]; // later stop

      if (itemA.dropStopSequence < itemB.dropStopSequence) {
        // Item A needs to be dropped BEFORE Item B.
        // If Item A is placed further forward than Item B (itemA.x < itemB.x) and shares cross-section:
        const xOverlap = itemA.position.xMeters < itemB.position.xMeters;
        const yOverlap = (
          itemA.position.yMeters < itemB.position.yMeters + itemB.dimensions.widthMeters &&
          itemA.position.yMeters + itemA.dimensions.widthMeters > itemB.position.yMeters
        );
        const zOverlap = (
          itemA.position.zMeters < itemB.position.zMeters + itemB.dimensions.heightMeters &&
          itemA.position.zMeters + itemA.dimensions.heightMeters > itemB.position.zMeters
        );

        if (xOverlap && yOverlap && zOverlap) {
          lifoViolations.push({
            blockedLoadId: itemA.id,
            blockingLoadId: itemB.id,
            blockedStop: itemA.dropStopSequence,
            blockingStop: itemB.dropStopSequence,
            message: `Load "${itemA.id}" (Stop ${itemA.dropStopSequence}) is trapped behind Load "${itemB.id}" (Stop ${itemB.dropStopSequence}). Manual restacking required.`,
          });
        }
      }
    }
  }

  return {
    success: unpackedItems.length === 0 && lifoViolations.length === 0,
    packedCount: packedItems.length,
    unpackedCount: unpackedItems.length,
    packedItems,
    unpackedItems,
    volumetricUtilizationPercentage: parseFloat(((packedVolume / totalTrailerVolume) * 100).toFixed(1)),
    lifoCompliant: lifoViolations.length === 0,
    lifoViolations,
  };
}

/**
 * Calculates non-linear diesel consumption penalties and overall consolidation yield.
 *
 * Models aerodynamic drag and rolling resistance:
 * Liters/100km = BaseRate * [1 + 0.4 * (GVW / GVW_max) + 0.35 * (GVW / GVW_max)^2]
 *
 * @param {object} params
 * @param {number} params.grossVehicleWeightKg - Total vehicle gross weight with cargo
 * @param {number} params.maxGvwKg - Rated GVW capacity
 * @param {number} params.distanceKm - Trip haul distance
 * @param {number} params.detourMinutes - Detour time required for consolidation
 * @param {number} params.totalRevenue - Spot freight payout
 * @param {number} [params.fuelPricePerLiter] - Diesel rate
 * @returns {object} Profitability, incremental fuel consumption, and net consolidation yield
 */
export function calculateConsolidationYield({
  grossVehicleWeightKg = 15000,
  maxGvwKg = CMVR_AXLE_LIMITS_KG.GROSS_VEHICLE_WEIGHT_MAX,
  distanceKm = 500,
  detourMinutes = 0,
  totalRevenue = 0,
  fuelPricePerLiter = CMVR_SAFETY_THRESHOLDS.DEFAULT_DIESEL_PRICE_PER_LITER,
}) {
  const loadRatio = Math.min(Math.max(grossVehicleWeightKg / maxGvwKg, 0), 1.5);

  // Non-linear consumption curve
  const baseRate = CMVR_SAFETY_THRESHOLDS.BASE_CONSUMPTION_L_PER_100KM;
  const consumptionRateLPer100Km = baseRate * (1 + (0.40 * loadRatio) + (0.35 * Math.pow(loadRatio, 2)));
  const totalFuelLiters = (consumptionRateLPer100Km / 100) * distanceKm;
  const totalFuelCost = totalFuelLiters * fuelPricePerLiter;

  // Detour labor & mechanical wear cost
  const detourCost = (detourMinutes / 60) * CMVR_SAFETY_THRESHOLDS.DEFAULT_DRIVER_HOURLY_RATE;

  // Net yield
  const netYield = totalRevenue - totalFuelCost - detourCost;
  const profitMarginPercentage = totalRevenue > 0 ? (netYield / totalRevenue) * 100 : 0;

  return {
    grossWeightKg: grossVehicleWeightKg,
    consumptionRateLPer100Km: parseFloat(consumptionRateLPer100Km.toFixed(2)),
    totalFuelLiters: parseFloat(totalFuelLiters.toFixed(2)),
    totalFuelCost: parseFloat(totalFuelCost.toFixed(2)),
    detourCost: parseFloat(detourCost.toFixed(2)),
    totalRevenue: parseFloat(totalRevenue.toFixed(2)),
    netYield: parseFloat(netYield.toFixed(2)),
    profitMarginPercentage: parseFloat(profitMarginPercentage.toFixed(1)),
    isProfitable: netYield > 0,
  };
}

/**
 * High-level orchestration service combining CMVR axle statics, 3D LIFO bin packing,
 * and non-linear diesel economics.
 */
export class AxleWeightOptimizationService {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Evaluates and optimizes LTL candidate loads against physical and statutory constraints.
   *
   * @param {object} truck - Truck parameters { id, remainingWeightKg, trailerSpec, truckSpec }
   * @param {Array<object>} candidateLoads - Candidate partial loads
   * @param {object} [options={}] - Optimization flags
   * @returns {object} Final optimized consolidation plan
   */
  optimizeConsolidation(truck, candidateLoads = [], options = {}) {
    const truckSpec = { ...DEFAULT_TRUCK_SPEC, ...(truck.truckSpec || {}) };
    const trailerSpec = {
      lengthMeters: truckSpec.trailerLengthMeters,
      widthMeters: truckSpec.trailerWidthMeters,
      heightMeters: truckSpec.trailerHeightMeters,
      ...(truck.trailerSpec || {}),
    };

    logger.info(`[AxleWeightOptimizationService] Optimizing consolidation for truck ${truck.id} with ${candidateLoads.length} candidate loads`);

    // 1. Solve 3D LIFO Packing
    const packingResult = pack3dLifoCargo(trailerSpec, candidateLoads);

    // 2. Map packed cargo positions to Axle Statics
    const placedCargoForStatics = packingResult.packedItems.map(item => ({
      weightKg: item.weightKg,
      xPositionMeters: item.position.xCenterMeters,
      lengthMeters: item.dimensions.lengthMeters,
    }));

    // 3. Compute CMVR Axle Load Distribution
    const axleStatics = calculateAxleWeightDistribution(truckSpec, placedCargoForStatics);

    // 4. Compute Non-linear Diesel Economics
    const totalPayout = candidateLoads.reduce((sum, l) => sum + (Number(l.payoutUSD || l.payoutINR || 0)), 0);
    const totalDetour = candidateLoads.reduce((sum, l) => sum + (Number(l.estimatedDetourMinutes || 0)), 0);

    const economics = calculateConsolidationYield({
      grossVehicleWeightKg: axleStatics.grossVehicleWeightKg,
      maxGvwKg: truckSpec.maxPayloadCapacityKg + truckSpec.tareSteerWeightKg + truckSpec.tareBogieWeightKg,
      distanceKm: Number(truck.routeDistanceKm || 500),
      detourMinutes: totalDetour,
      totalRevenue: totalPayout,
      fuelPricePerLiter: truckSpec.fuelPricePerLiter,
    });

    const approved = packingResult.success && axleStatics.compliant && economics.isProfitable;

    return {
      truckId: truck.id,
      approved,
      rejectionReasons: [
        ...(!packingResult.success ? packingResult.lifoViolations.map(v => v.message) : []),
        ...(!axleStatics.compliant ? axleStatics.violations.map(v => v.message) : []),
        ...(!economics.isProfitable ? ['Consolidation yield is negative after non-linear fuel penalties and detour costs'] : []),
      ],
      packing: packingResult,
      axleStatics,
      economics,
    };
  }
}

export const defaultAxleWeightService = new AxleWeightOptimizationService();
export default defaultAxleWeightService;
