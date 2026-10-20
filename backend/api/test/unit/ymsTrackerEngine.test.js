import assert from 'assert';
import crypto from 'crypto';
import { describe, it, beforeEach } from 'node:test';
import {
    calculateDistanceMeters,
    registerYardSlot,
    listYardSlots,
    allocateYardSlot,
    releaseYardSlot,
    evaluateDwellDemurrage,
    generateDemurrageInvoice,
    recordTrailerDrop,
    locateTrailerInYard,
    resetYardState,
    SlotType,
    SlotStatus,
    DwellStatus
} from '../../src/services/ymsTracker.js';

describe('Yard Management System (YMS) Engine & Dwell Demurrage Suite', () => {
    const facilityId = 'FAC-ORD-CHICAGO-01';

    beforeEach(() => {
        resetYardState();
    });

    it('should calculate accurate Haversine GPS distances and handle invalid inputs gracefully', () => {
        // Chicago O'Hare to Midway
        const ordLat = 41.9742, ordLon = -87.9073;
        const mdwLat = 41.7868, mdwLon = -87.7522;
        const dist = calculateDistanceMeters(ordLat, ordLon, mdwLat, mdwLon);
        assert.ok(dist > 24000 && dist < 28000, `Expected ~25km, got ${dist}`);

        // Invalid coordinate checks
        assert.ok(Number.isNaN(calculateDistanceMeters('invalid', ordLon, mdwLat, mdwLon)));
        assert.ok(Number.isNaN(calculateDistanceMeters(100, ordLon, mdwLat, mdwLon))); // lat > 90
        assert.ok(Number.isNaN(calculateDistanceMeters(ordLat, -200, mdwLat, mdwLon))); // lon < -180
    });

    it('should register and filter yard slots by type and physical capabilities', () => {
        registerYardSlot(facilityId, {
            slotId: 'SLOT-A01',
            slotType: SlotType.DRY_VAN,
            maxLengthFeet: 53,
            hasReeferPlug: false,
            isHazmatApproved: false,
            zone: 'NORTH_YARD',
            coordinates: { latitude: 41.974, longitude: -87.907 }
        });

        registerYardSlot(facilityId, {
            slotId: 'SLOT-R01',
            slotType: SlotType.REEFER_ELECTRIC,
            maxLengthFeet: 53,
            hasReeferPlug: true,
            isHazmatApproved: false,
            zone: 'COLD_STORAGE_PAD',
            coordinates: { latitude: 41.975, longitude: -87.908 }
        });

        registerYardSlot(facilityId, {
            slotId: 'SLOT-H01',
            slotType: SlotType.HAZMAT_CONTAINMENT,
            maxLengthFeet: 53,
            hasReeferPlug: false,
            isHazmatApproved: true,
            zone: 'HAZMAT_BERM',
            coordinates: { latitude: 41.976, longitude: -87.909 }
        });

        const allSlots = listYardSlots(facilityId);
        assert.strictEqual(allSlots.length, 3);

        const reeferSlots = listYardSlots(facilityId, { hasReeferPlug: true });
        assert.strictEqual(reeferSlots.length, 1);
        assert.strictEqual(reeferSlots[0].slotId, 'SLOT-R01');

        const hazmatSlots = listYardSlots(facilityId, { isHazmatApproved: true });
        assert.strictEqual(hazmatSlots.length, 1);
        assert.strictEqual(hazmatSlots[0].slotId, 'SLOT-H01');
    });

    it('should enforce reefer and hazmat physical constraints during slot allocation', () => {
        registerYardSlot(facilityId, {
            slotId: 'SLOT-DRY-01',
            slotType: SlotType.DRY_VAN,
            maxLengthFeet: 53,
            hasReeferPlug: false,
            isHazmatApproved: false,
            coordinates: { latitude: 41.9740, longitude: -87.9070 }
        });

        registerYardSlot(facilityId, {
            slotId: 'SLOT-REEFER-01',
            slotType: SlotType.REEFER_ELECTRIC,
            maxLengthFeet: 53,
            hasReeferPlug: true,
            isHazmatApproved: false,
            coordinates: { latitude: 41.9745, longitude: -87.9075 }
        });

        // Request reefer allocation - should not pick SLOT-DRY-01
        const allocResult = allocateYardSlot(facilityId, {
            trailerId: 'TRL-REEFER-900',
            isReefer: true,
            trailerLengthFeet: 53
        });

        assert.strictEqual(allocResult.allocated, true);
        assert.strictEqual(allocResult.slotId, 'SLOT-REEFER-01');

        // Second reefer trailer cannot be accommodated
        const secondReeferAlloc = allocateYardSlot(facilityId, {
            trailerId: 'TRL-REEFER-901',
            isReefer: true
        });
        assert.strictEqual(secondReeferAlloc.allocated, false);
        assert.strictEqual(secondReeferAlloc.reason, 'NO_SLOT_MEETING_PHYSICAL_CONSTRAINTS');
    });

    it('should optimize slot selection based on proximity to target dock door', () => {
        // Slot Far (1000m away)
        registerYardSlot(facilityId, {
            slotId: 'SLOT-FAR',
            slotType: SlotType.DRY_VAN,
            coordinates: { latitude: 41.9800, longitude: -87.9000 }
        });

        // Slot Close (50m away from dock)
        registerYardSlot(facilityId, {
            slotId: 'SLOT-NEAR',
            slotType: SlotType.DRY_VAN,
            coordinates: { latitude: 41.9742, longitude: -87.9071 }
        });

        const dockCoords = { latitude: 41.9741, longitude: -87.9070 };
        const alloc = allocateYardSlot(facilityId, {
            trailerId: 'TRL-PROX-101',
            targetDockDoorCoordinates: dockCoords
        });

        assert.strictEqual(alloc.allocated, true);
        assert.strictEqual(alloc.slotId, 'SLOT-NEAR');
    });

    it('should correctly transition slot status and release trailer on checkout', () => {
        registerYardSlot(facilityId, {
            slotId: 'SLOT-X01',
            slotType: SlotType.DRY_VAN,
            coordinates: { latitude: 41.9740, longitude: -87.9070 }
        });

        const alloc = allocateYardSlot(facilityId, { trailerId: 'TRL-OCC-55' });
        assert.strictEqual(alloc.allocated, true);

        const slotsOccupied = listYardSlots(facilityId, { status: SlotStatus.OCCUPIED });
        assert.strictEqual(slotsOccupied.length, 1);
        assert.strictEqual(slotsOccupied[0].currentTrailerId, 'TRL-OCC-55');

        const release = releaseYardSlot(facilityId, 'SLOT-X01');
        assert.strictEqual(release.success, true);
        assert.strictEqual(release.releasedTrailerId, 'TRL-OCC-55');

        const slotsAvail = listYardSlots(facilityId, { status: SlotStatus.AVAILABLE });
        assert.strictEqual(slotsAvail.length, 1);
    });

    it('should calculate tiered demurrage fee accurately across all delinquency brackets', () => {
        registerYardSlot(facilityId, { slotId: 'SLOT-DWELL-1' });
        allocateYardSlot(facilityId, { trailerId: 'TRL-DWELL-88' });

        const now = Date.now();

        // 1. Within Free Time (1.5 hours in)
        const check1 = evaluateDwellDemurrage('TRL-DWELL-88', new Date(now + 1.5 * 3600 * 1000).toISOString());
        assert.strictEqual(check1.dwellStatus, DwellStatus.FREE_TIME);
        assert.strictEqual(check1.feeBreakdownUSD.totalDemurrageUSD, 0);

        // 2. In Grace Period (2.25 hours in, free time = 2.0 hrs + 30 min grace)
        const check2 = evaluateDwellDemurrage('TRL-DWELL-88', new Date(now + 2.25 * 3600 * 1000).toISOString());
        assert.strictEqual(check2.dwellStatus, DwellStatus.GRACE_PERIOD);
        assert.strictEqual(check2.feeBreakdownUSD.totalDemurrageUSD, 0);

        // 3. Tier 1 Demurrage: 2.5 hrs free + 3.0 billable hours = 5.5 hours elapsed
        // 3.0 hrs * $50 = $150
        const check3 = evaluateDwellDemurrage('TRL-DWELL-88', new Date(now + 5.5 * 3600 * 1000).toISOString());
        assert.strictEqual(check3.dwellStatus, DwellStatus.DEMURRAGE_ACCRUING);
        assert.strictEqual(check3.feeBreakdownUSD.tier1Charge, 150);
        assert.strictEqual(check3.feeBreakdownUSD.tier2Charge, 0);
        assert.strictEqual(check3.feeBreakdownUSD.totalDemurrageUSD, 150);

        // 4. Tier 2 Demurrage: 2.5 hrs free + 10 billable hours = 12.5 hours elapsed
        // Tier 1: 4 hrs * $50 = $200
        // Tier 2: 6 hrs * $85 = $510
        // Total = $710
        const check4 = evaluateDwellDemurrage('TRL-DWELL-88', new Date(now + 12.5 * 3600 * 1000).toISOString());
        assert.strictEqual(check4.feeBreakdownUSD.tier1Charge, 200);
        assert.strictEqual(check4.feeBreakdownUSD.tier2Charge, 510);
        assert.strictEqual(check4.feeBreakdownUSD.totalDemurrageUSD, 710);

        // 5. Exceeded Max Allowable Hold (75 hours elapsed)
        const check5 = evaluateDwellDemurrage('TRL-DWELL-88', new Date(now + 75 * 3600 * 1000).toISOString());
        assert.strictEqual(check5.dwellStatus, DwellStatus.EXCEEDED_MAX_HOLD);
        assert.strictEqual(check5.requiresEscalation, true);
        assert.ok(check5.feeBreakdownUSD.totalDemurrageUSD > 7000);
    });

    it('should generate an HMAC-SHA256 cryptographically sealed demurrage invoice', () => {
        registerYardSlot(facilityId, { slotId: 'SLOT-INV-1' });
        allocateYardSlot(facilityId, { trailerId: 'TRL-SEAL-01' });

        const checkout = new Date(Date.now() + 6.5 * 3600 * 1000).toISOString();
        const invoice = generateDemurrageInvoice('TRL-SEAL-01', {
            carrierName: 'Swift Freight Logistics',
            carrierDotNumber: 'DOT-4982103'
        }, checkout);

        assert.ok(invoice.invoiceId.startsWith('INV-DEM-TRL-SEAL-01'));
        assert.strictEqual(invoice.carrierName, 'Swift Freight Logistics');
        assert.ok(invoice.totalDueUSD > 0);
        assert.ok(typeof invoice.invoiceSeal === 'string' && invoice.invoiceSeal.length === 64);

        // Verify seal signature
        const { invoiceSeal, ...payload } = invoice;
        const expectedSeal = crypto.createHmac('sha256', 'YARD_DEMURRAGE_SETTLEMENT_KEY')
            .update(JSON.stringify(payload))
            .digest('hex');
        assert.strictEqual(invoiceSeal, expectedSeal);
    });

    it('should record trailer drop pins and provide AR waypoints accurately', () => {
        const drop = recordTrailerDrop({
            trailerId: 'TRL-DROP-77',
            driverId: 'DRV-101',
            facilityId,
            latitude: 41.9745,
            longitude: -87.9075,
            yardSlotId: 'SLOT-P12',
            zone: 'WEST_BAY'
        });

        assert.strictEqual(drop.trailerId, 'TRL-DROP-77');
        assert.strictEqual(drop.yardSlotId, 'SLOT-P12');

        // Locate from nearby driver position
        const loc = locateTrailerInYard('TRL-DROP-77', {
            latitude: 41.9740,
            longitude: -87.9070
        });

        assert.strictEqual(loc.found, true);
        assert.ok(loc.driverProximityMeters > 0);
        assert.strictEqual(loc.arGuidance.targetSlot, 'SLOT-P12');
        assert.strictEqual(loc.arGuidance.navigationSteps.length, 4);
    });
});
