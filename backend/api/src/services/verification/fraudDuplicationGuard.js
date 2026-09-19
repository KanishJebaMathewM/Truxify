import logger from '../../middleware/logger.js';
import { supabase } from '../../config/db.js';

export class FraudDuplicationGuard {
  constructor(options = {}) {
    this.supabase = options.supabase || supabase;
  }

  /**
   * Evaluates whether an e-Way bill or document content hash has already been used on an active trip.
   * 
   * @param {object} params
   * @param {string} params.tripId - Current trip ID
   * @param {string} params.ewayBillNumber - 12-digit e-Way bill number
   * @param {string} params.sha256Hash - SHA-256 hash of the uploaded document buffer
   * @param {string} [params.assignedVehicleNumber] - Vehicle number assigned to the trip
   * @param {string} [params.extractedVehicleNumber] - Vehicle number extracted from e-Way bill Part-B
   * @returns {Promise<{isApproved: boolean, fraudFlags: string[], reason?: string}>}
   */
  async evaluateDocumentUniqueness(params) {
    const {
      tripId,
      ewayBillNumber,
      sha256Hash,
      assignedVehicleNumber,
      extractedVehicleNumber,
    } = params;

    const fraudFlags = [];

    // 1. Check for Duplicate SHA-256 Document Content Hash in Active Trips
    if (sha256Hash && this.supabase && typeof this.supabase.from === 'function') {
      try {
        const { data: duplicateDocs, error: hashError } = await this.supabase
          .from('eway_bill_verifications')
          .select('id, trip_id, status, created_at')
          .eq('sha256_hash', sha256Hash)
          .neq('trip_id', tripId)
          .eq('status', 'ACTIVE')
          .limit(1);

        if (!hashError && duplicateDocs && duplicateDocs.length > 0) {
          fraudFlags.push(`DUPLICATE_DOCUMENT_HASH: Identical file already attached to active trip #${duplicateDocs[0].trip_id}`);
        }
      } catch (err) {
        logger.warn({ err, tripId }, '[FraudDuplicationGuard] Database hash check query failed');
      }
    }

    // 2. Check for Duplicate e-Way Bill Number in Active Trips
    if (ewayBillNumber && this.supabase && typeof this.supabase.from === 'function') {
      try {
        const { data: duplicateBills, error: billError } = await this.supabase
          .from('eway_bill_verifications')
          .select('id, trip_id, status, created_at')
          .eq('eway_bill_number', ewayBillNumber)
          .neq('trip_id', tripId)
          .eq('status', 'ACTIVE')
          .limit(1);

        if (!billError && duplicateBills && duplicateBills.length > 0) {
          fraudFlags.push(`DUPLICATE_EWAY_BILL_NUMBER: e-Way Bill #${ewayBillNumber} is already in transit on trip #${duplicateBills[0].trip_id}`);
        }
      } catch (err) {
        logger.warn({ err, tripId }, '[FraudDuplicationGuard] Database eway bill check query failed');
      }
    }

    // 3. Vehicle Number Mismatch Check (e-Way Bill Part-B vs Assigned Truck)
    if (assignedVehicleNumber && extractedVehicleNumber) {
      const cleanAssigned = assignedVehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');
      const cleanExtracted = extractedVehicleNumber.toUpperCase().replace(/[^A-Z0-9]/g, '');

      if (cleanAssigned !== cleanExtracted) {
        fraudFlags.push(`VEHICLE_MISMATCH: e-Way Bill specifies truck '${cleanExtracted}', but trip is assigned to '${cleanAssigned}'`);
      }
    }

    const isApproved = fraudFlags.length === 0;

    return {
      isApproved,
      fraudFlags,
      reason: isApproved ? 'Document uniqueness verified' : fraudFlags.join('; '),
      evaluatedAt: new Date().toISOString(),
    };
  }

  /**
   * Persists an approved e-Way bill record to prevent future duplication.
   * 
   * @param {object} record
   * @returns {Promise<boolean>}
   */
  async recordVerification(record) {
    if (!this.supabase || typeof this.supabase.from !== 'function') {
      return false;
    }

    try {
      await this.supabase.from('eway_bill_verifications').insert({
        trip_id: record.tripId,
        eway_bill_number: record.ewayBillNumber,
        sha256_hash: record.sha256Hash,
        supplier_gstin: record.supplierGstin,
        recipient_gstin: record.recipientGstin,
        vehicle_number: record.vehicleNumber,
        status: 'ACTIVE',
        created_at: new Date().toISOString(),
      });
      return true;
    } catch (err) {
      logger.error({ err, tripId: record.tripId }, '[FraudDuplicationGuard] Failed to record verification');
      return false;
    }
  }
}

export default FraudDuplicationGuard;
