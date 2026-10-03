import crypto from 'crypto';

// In-memory stores for active yard trailer pins, yard slot inventory, appointments, and dwell records
const trailerYardPins = new Map();
const yardSlots = new Map(); // facilityId -> Map(slotId, slotRecord)
const trailerDwellLedger = new Map(); // trailerId -> dwellRecord
const dockAppointments = new Map(); // appointmentId -> appointmentRecord
const hostlerTaskQueue = [];

export const SlotType = {
    DRY_VAN: 'DRY_VAN',
    REEFER_ELECTRIC: 'REEFER_ELECTRIC',
    HAZMAT_CONTAINMENT: 'HAZMAT_CONTAINMENT',
    FLATBED_OVERSIZE: 'FLATBED_OVERSIZE',
    STAGING_LANE: 'STAGING_LANE',
    DOCK_DOOR: 'DOCK_DOOR'
};

export const SlotStatus = {
    AVAILABLE: 'AVAILABLE',
    OCCUPIED: 'OCCUPIED',
    RESERVED: 'RESERVED',
    MAINTENANCE: 'MAINTENANCE'
};

export const DwellStatus = {
    FREE_TIME: 'FREE_TIME',
    GRACE_PERIOD: 'GRACE_PERIOD',
    DETENTION_WARNING: 'DETENTION_WARNING',
    DEMURRAGE_ACCRUING: 'DEMURRAGE_ACCRUING',
    EXCEEDED_MAX_HOLD: 'EXCEEDED_MAX_HOLD'
};

// Default demurrage pricing tiers ($ / hour)
export const DEFAULT_DEMURRAGE_POLICY = {
    freeTimeHours: 2.0,
    gracePeriodMinutes: 30,
    tier1HourlyRate: 50.0,  // First 4 hours past free time
    tier2HourlyRate: 85.0,  // Next 12 hours
    tier3HourlyRate: 150.0, // After 16 hours delinquent
    maxAllowableDwellHours: 72.0
};

/**
 * Calculates straight-line distance (haversine) in meters between two GPS coordinates.
 */
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
    if (
        typeof lat1 !== 'number' || typeof lon1 !== 'number' ||
        typeof lat2 !== 'number' || typeof lon2 !== 'number' ||
        !Number.isFinite(lat1) || !Number.isFinite(lon1) ||
        !Number.isFinite(lat2) || !Number.isFinite(lon2) ||
        lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 ||
        lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180
    ) {
        return NaN;
    }
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * (Math.PI / 180);
    const dLon = (lon2 - lon1) * (Math.PI / 180);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
}

/**
 * Registers or updates a slot in the yard inventory.
 */
export function registerYardSlot(facilityId, slotData) {
    if (!facilityId || typeof facilityId !== 'string') {
        throw new Error('Valid facilityId is required to register a yard slot.');
    }
    if (!slotData || !slotData.slotId) {
        throw new Error('slotData.slotId is required.');
    }

    if (!yardSlots.has(facilityId)) {
        yardSlots.set(facilityId, new Map());
    }

    const facilityMap = yardSlots.get(facilityId);
    const record = {
        slotId: slotData.slotId,
        facilityId,
        slotType: slotData.slotType || SlotType.DRY_VAN,
        status: slotData.status || SlotStatus.AVAILABLE,
        maxLengthFeet: Number(slotData.maxLengthFeet) || 53,
        hasReeferPlug: Boolean(slotData.hasReeferPlug),
        isHazmatApproved: Boolean(slotData.isHazmatApproved),
        zone: slotData.zone || 'GENERAL_YARD',
        coordinates: slotData.coordinates || { latitude: 0, longitude: 0 },
        currentTrailerId: slotData.currentTrailerId || null,
        lastUpdated: new Date().toISOString()
    };

    facilityMap.set(slotData.slotId, record);
    return record;
}

/**
 * Lists yard slots with optional filtering by type, status, or zone.
 */
export function listYardSlots(facilityId, filters = {}) {
    const facilityMap = yardSlots.get(facilityId);
    if (!facilityMap) return [];

    let slots = Array.from(facilityMap.values());
    if (filters.status) {
        slots = slots.filter(s => s.status === filters.status);
    }
    if (filters.slotType) {
        slots = slots.filter(s => s.slotType === filters.slotType);
    }
    if (filters.hasReeferPlug !== undefined) {
        slots = slots.filter(s => s.hasReeferPlug === Boolean(filters.hasReeferPlug));
    }
    if (filters.isHazmatApproved !== undefined) {
        slots = slots.filter(s => s.isHazmatApproved === Boolean(filters.isHazmatApproved));
    }
    return slots;
}

/**
 * Intelligently allocates an optimal yard slot based on trailer operational constraints.
 */
export function allocateYardSlot(facilityId, trailerRequirements = {}) {
    const {
        trailerId,
        trailerLengthFeet = 53,
        isReefer = false,
        isHazmat = false,
        targetDockDoorCoordinates = null
    } = trailerRequirements;

    if (!facilityId || !trailerId) {
        throw new Error('facilityId and trailerId are required for yard slot allocation.');
    }

    const availableSlots = listYardSlots(facilityId, { status: SlotStatus.AVAILABLE });
    if (availableSlots.length === 0) {
        return {
            allocated: false,
            reason: 'NO_AVAILABLE_SLOTS',
            suggestedAction: 'QUEUE_AT_STAGING_ENTRY'
        };
    }

    // Constraint Filtering
    const eligibleSlots = availableSlots.filter(slot => {
        if (slot.maxLengthFeet < trailerLengthFeet) return false;
        if (isReefer && !slot.hasReeferPlug && slot.slotType !== SlotType.REEFER_ELECTRIC) return false;
        if (isHazmat && !slot.isHazmatApproved && slot.slotType !== SlotType.HAZMAT_CONTAINMENT) return false;
        return true;
    });

    if (eligibleSlots.length === 0) {
        return {
            allocated: false,
            reason: 'NO_SLOT_MEETING_PHYSICAL_CONSTRAINTS',
            suggestedAction: 'OVERFLOW_HOLDING_LANE'
        };
    }

    // Cost Optimization: Pick slot closest to target dock door or first eligible
    let selectedSlot = eligibleSlots[0];
    if (targetDockDoorCoordinates && targetDockDoorCoordinates.latitude && targetDockDoorCoordinates.longitude) {
        let minDistance = Infinity;
        for (const slot of eligibleSlots) {
            const dist = calculateDistanceMeters(
                slot.coordinates.latitude,
                slot.coordinates.longitude,
                targetDockDoorCoordinates.latitude,
                targetDockDoorCoordinates.longitude
            );
            if (!Number.isNaN(dist) && dist < minDistance) {
                minDistance = dist;
                selectedSlot = slot;
            }
        }
    }

    // Mark slot as occupied
    selectedSlot.status = SlotStatus.OCCUPIED;
    selectedSlot.currentTrailerId = trailerId;
    selectedSlot.lastUpdated = new Date().toISOString();

    // Start dwell tracking
    const now = new Date();
    trailerDwellLedger.set(trailerId, {
        trailerId,
        facilityId,
        assignedSlotId: selectedSlot.slotId,
        checkInTime: now.toISOString(),
        checkOutTime: null,
        lastStatusEvaluation: now.toISOString(),
        totalDemurrageOwedUSD: 0.0
    });

    return {
        allocated: true,
        slotId: selectedSlot.slotId,
        zone: selectedSlot.zone,
        slotType: selectedSlot.slotType,
        coordinates: selectedSlot.coordinates,
        checkInTime: now.toISOString()
    };
}

/**
 * Releases a yard slot when trailer checks out or departs.
 */
export function releaseYardSlot(facilityId, slotId) {
    const facilityMap = yardSlots.get(facilityId);
    if (!facilityMap || !facilityMap.has(slotId)) {
        throw new Error(`Yard slot ${slotId} not found in facility ${facilityId}`);
    }
    const slot = facilityMap.get(slotId);
    const departedTrailerId = slot.currentTrailerId;

    slot.status = SlotStatus.AVAILABLE;
    slot.currentTrailerId = null;
    slot.lastUpdated = new Date().toISOString();

    if (departedTrailerId && trailerDwellLedger.has(departedTrailerId)) {
        const dwellRecord = trailerDwellLedger.get(departedTrailerId);
        dwellRecord.checkOutTime = new Date().toISOString();
    }

    return {
        success: true,
        slotId,
        facilityId,
        releasedTrailerId: departedTrailerId,
        newStatus: SlotStatus.AVAILABLE
    };
}

/**
 * Evaluates dwell time, graduated demurrage charges, and overstay violation alerts.
 */
export function evaluateDwellDemurrage(trailerId, evaluationTimestamp = null, customPolicy = {}) {
    const dwell = trailerDwellLedger.get(trailerId);
    if (!dwell) {
        throw new Error(`No active dwell tracking record found for trailer ${trailerId}`);
    }

    const policy = { ...DEFAULT_DEMURRAGE_POLICY, ...customPolicy };
    const checkInMs = new Date(dwell.checkInTime).getTime();
    const evalMs = evaluationTimestamp ? new Date(evaluationTimestamp).getTime() : Date.now();

    if (evalMs < checkInMs) {
        throw new Error('Evaluation timestamp cannot be earlier than checkInTime');
    }

    const elapsedHours = (evalMs - checkInMs) / (1000 * 60 * 60);
    const freeTimeAllowanceHours = policy.freeTimeHours + (policy.gracePeriodMinutes / 60);

    let dwellStatus = DwellStatus.FREE_TIME;
    let billableHours = 0;
    let tier1Charge = 0;
    let tier2Charge = 0;
    let tier3Charge = 0;

    if (elapsedHours <= policy.freeTimeHours) {
        dwellStatus = DwellStatus.FREE_TIME;
    } else if (elapsedHours <= freeTimeAllowanceHours) {
        dwellStatus = DwellStatus.GRACE_PERIOD;
    } else {
        billableHours = elapsedHours - freeTimeAllowanceHours;

        if (elapsedHours > policy.maxAllowableDwellHours) {
            dwellStatus = DwellStatus.EXCEEDED_MAX_HOLD;
        } else if (billableHours > 0) {
            dwellStatus = DwellStatus.DEMURRAGE_ACCRUING;
        }

        // Tier 1: First 4 billable hours
        const tier1Hours = Math.min(billableHours, 4);
        tier1Charge = tier1Hours * policy.tier1HourlyRate;

        // Tier 2: Next 12 billable hours (hours 4 to 16)
        if (billableHours > 4) {
            const tier2Hours = Math.min(billableHours - 4, 12);
            tier2Charge = tier2Hours * policy.tier2HourlyRate;
        }

        // Tier 3: Beyond 16 billable hours
        if (billableHours > 16) {
            const tier3Hours = billableHours - 16;
            tier3Charge = tier3Hours * policy.tier3HourlyRate;
        }
    }

    const totalDemurrage = parseFloat((tier1Charge + tier2Charge + tier3Charge).toFixed(2));
    dwell.totalDemurrageOwedUSD = totalDemurrage;
    dwell.lastStatusEvaluation = new Date(evalMs).toISOString();

    return {
        trailerId,
        facilityId: dwell.facilityId,
        assignedSlotId: dwell.assignedSlotId,
        checkInTime: dwell.checkInTime,
        evaluationTime: new Date(evalMs).toISOString(),
        elapsedHours: parseFloat(elapsedHours.toFixed(2)),
        billableHours: parseFloat(billableHours.toFixed(2)),
        dwellStatus,
        feeBreakdownUSD: {
            tier1Charge: parseFloat(tier1Charge.toFixed(2)),
            tier2Charge: parseFloat(tier2Charge.toFixed(2)),
            tier3Charge: parseFloat(tier3Charge.toFixed(2)),
            totalDemurrageUSD: totalDemurrage
        },
        requiresEscalation: dwellStatus === DwellStatus.EXCEEDED_MAX_HOLD
    };
}

/**
 * Generates an immutable cryptographic demurrage settlement invoice.
 */
export function generateDemurrageInvoice(trailerId, carrierInfo = {}, checkoutTimestamp = null) {
    const dwellAnalysis = evaluateDwellDemurrage(trailerId, checkoutTimestamp);
    const invoiceId = `INV-DEM-${trailerId}-${Date.now()}`;

    const invoicePayload = {
        invoiceId,
        trailerId,
        carrierName: carrierInfo.carrierName || 'INDEPENDENT_CARRIER',
        carrierDotNumber: carrierInfo.carrierDotNumber || 'DOT-UNSPECIFIED',
        facilityId: dwellAnalysis.facilityId,
        assignedSlotId: dwellAnalysis.assignedSlotId,
        checkInTime: dwellAnalysis.checkInTime,
        checkOutTime: dwellAnalysis.evaluationTime,
        elapsedHours: dwellAnalysis.elapsedHours,
        billableHours: dwellAnalysis.billableHours,
        totalDueUSD: dwellAnalysis.feeBreakdownUSD.totalDemurrageUSD,
        issuedAt: new Date().toISOString()
    };

    const signature = crypto.createHmac('sha256', 'YARD_DEMURRAGE_SETTLEMENT_KEY')
        .update(JSON.stringify(invoicePayload))
        .digest('hex');

    return {
        ...invoicePayload,
        invoiceSeal: signature
    };
}

/**
 * Records a high-precision GPS drop pin when a driver unhooks a trailer in a distribution yard.
 */
export function recordTrailerDrop(dropData) {
    const {
        trailerId,
        driverId,
        facilityId,
        latitude,
        longitude,
        yardSlotId = 'UNASSIGNED_SLOT',
        zone = 'GENERAL_YARD'
    } = dropData;

    const pinRecord = {
        trailerId,
        droppedByDriverId: driverId,
        facilityId,
        coordinates: {
            latitude,
            longitude,
            precisionMeters: 1.5
        },
        yardSlotId,
        zone,
        droppedAt: new Date().toISOString()
    };

    trailerYardPins.set(trailerId, pinRecord);
    return pinRecord;
}

/**
 * Retrieves the exact location pin of a dropped trailer and provides AR/micro-location waypoints.
 */
export function locateTrailerInYard(trailerId, driverLocation = {}) {
    const pin = trailerYardPins.get(trailerId);

    if (!pin) {
        return {
            found: false,
            message: `No active micro-location pin found for trailer ${trailerId}`
        };
    }

    let distanceMeters = null;
    let arNavigationSteps = [];

    if (
        driverLocation != null &&
        Number.isFinite(driverLocation.latitude) &&
        Number.isFinite(driverLocation.longitude)
    ) {
        const calculatedDistance = calculateDistanceMeters(
            driverLocation.latitude,
            driverLocation.longitude,
            pin.coordinates.latitude,
            pin.coordinates.longitude
        );

        if (!Number.isNaN(calculatedDistance)) {
            distanceMeters = calculatedDistance;
            arNavigationSteps = [
                `Proceed to Yard Zone: ${pin.zone}`,
                `Navigate towards Aisle/Slot: ${pin.yardSlotId}`,
                `Trailer pin distance: ${distanceMeters} meters away`,
                `Follow AR visual indicator to high-precision GPS pin (${pin.coordinates.latitude}, ${pin.coordinates.longitude})`
            ];
        }
    }

    return {
        found: true,
        trailerPin: pin,
        driverProximityMeters: distanceMeters,
        arGuidance: {
            targetSlot: pin.yardSlotId,
            zone: pin.zone,
            navigationSteps: arNavigationSteps
        }
    };
}

/**
 * Clears in-memory yard state (used for testing resets).
 */
export function resetYardState() {
    trailerYardPins.clear();
    yardSlots.clear();
    trailerDwellLedger.clear();
    dockAppointments.clear();
    hostlerTaskQueue.length = 0;
}
