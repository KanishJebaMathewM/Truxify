import logger from '../../middleware/logger.js';

export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
export const EWAY_BILL_REGEX = /^\d{12}$/;
export const VEHICLE_NUMBER_REGEX = /^[A-Z]{2}[0-9]{1,2}[A-Z]{1,3}[0-9]{4}$/;

export class EwayBillParser {
  /**
   * Normalizes Indian vehicle registration strings (removes spaces, hyphens, uppercase).
   * @param {string} str
   * @returns {string}
   */
  normalizeVehicleNumber(str) {
    if (!str || typeof str !== 'string') return '';
    return str.toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  /**
   * Validates Indian GSTIN format.
   * @param {string} gstin
   * @returns {boolean}
   */
  isValidGstin(gstin) {
    if (!gstin || typeof gstin !== 'string') return false;
    const clean = gstin.trim().toUpperCase();
    return GSTIN_REGEX.test(clean);
  }

  /**
   * Parses and validates raw extracted OCR text or QR payload from an e-Way bill document.
   * 
   * @param {string|object} rawInput - Extracted text string or decoded JSON QR payload
   * @returns {object} Extracted structured e-Way bill fields
   */
  parse(rawInput) {
    if (!rawInput) {
      throw new Error('Empty e-Way bill input');
    }

    let ewayBillNumber = '';
    let gstinSupplier = '';
    let gstinRecipient = '';
    let vehicleNumber = '';
    let hsnCode = '';
    let validUntil = null;
    let documentDate = null;
    let totalValueInr = 0;
    let consignorName = '';
    let consigneeName = '';

    if (typeof rawInput === 'object') {
      // Direct QR Code / NIC structured JSON payload
      ewayBillNumber = String(rawInput.ewbNo || rawInput.ewayBillNo || rawInput.ewayBillNumber || '').trim();
      gstinSupplier = String(rawInput.genGstin || rawInput.supplierGstin || rawInput.fromGstin || '').trim().toUpperCase();
      gstinRecipient = String(rawInput.toGstin || rawInput.recipientGstin || '').trim().toUpperCase();
      vehicleNumber = this.normalizeVehicleNumber(rawInput.vehicleNo || rawInput.vehicleNumber || '');
      hsnCode = String(rawInput.mainHsnCode || rawInput.hsnCode || '').trim();
      validUntil = rawInput.validUpto || rawInput.validUntil || null;
      documentDate = rawInput.docDate || rawInput.documentDate || null;
      totalValueInr = Number(rawInput.totalValue || rawInput.totValue || 0);
      consignorName = rawInput.fromTrdName || rawInput.consignor || '';
      consigneeName = rawInput.toTrdName || rawInput.consignee || '';
    } else {
      // Unstructured OCR text regex extraction
      const text = String(rawInput);

      // 1. Extract 12-digit e-Way bill number
      const ewbMatch = text.match(/e-?way\s*bill\s*(?:no|number)?[\s.:#]*([0-9]{12})/i) || text.match(/\b([0-9]{12})\b/);
      if (ewbMatch) {
        ewayBillNumber = ewbMatch[1];
      }

      // 2. Extract GSTINs
      const gstinMatches = text.match(/[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}/g);
      if (gstinMatches && gstinMatches.length > 0) {
        gstinSupplier = gstinMatches[0];
        if (gstinMatches.length > 1) {
          gstinRecipient = gstinMatches[1];
        }
      }

      // 3. Extract Vehicle Number
      const vehicleMatch = text.match(/\b([A-Z]{2}[-\s]?[0-9]{1,2}[-\s]?[A-Z]{1,3}[-\s]?[0-9]{4})\b/i);
      if (vehicleMatch) {
        vehicleNumber = this.normalizeVehicleNumber(vehicleMatch[1]);
      }

      // 4. Extract HSN Code (4-8 digits)
      const hsnMatch = text.match(/HSN[\s.:#]*([0-9]{4,8})/i);
      if (hsnMatch) {
        hsnCode = hsnMatch[1];
      }

      // 5. Extract Valid Upto Date
      const dateMatch = text.match(/valid\s*(?:upto|until)[\s.:#]*([0-9]{2}[\/-][0-9]{2}[\/-][0-9]{4}(?:\s+[0-9]{2}:[0-9]{2}(?::[0-9]{2})?)?)/i);
      if (dateMatch) {
        validUntil = dateMatch[1];
      }
    }

    // Validation checks
    const isEwbValid = EWAY_BILL_REGEX.test(ewayBillNumber);
    const isSupplierGstinValid = this.isValidGstin(gstinSupplier);
    const isRecipientGstinValid = gstinRecipient ? this.isValidGstin(gstinRecipient) : true;
    const isVehicleValid = vehicleNumber ? VEHICLE_NUMBER_REGEX.test(vehicleNumber) : false;

    // Check expiration if validUntil is present
    let isExpired = false;
    let validUntilDate = null;
    if (validUntil) {
      const parsedDate = new Date(validUntil);
      if (!isNaN(parsedDate.getTime())) {
        validUntilDate = parsedDate.toISOString();
        isExpired = parsedDate.getTime() < Date.now();
      }
    }

    return {
      ewayBillNumber,
      gstinSupplier,
      gstinRecipient,
      vehicleNumber,
      hsnCode,
      validUntil: validUntilDate || validUntil,
      documentDate,
      totalValueInr,
      consignorName,
      consigneeName,
      validationFlags: {
        isEwbFormatValid: isEwbValid,
        isSupplierGstinValid,
        isRecipientGstinValid,
        isVehicleFormatValid: isVehicleValid,
        isExpired,
      },
      parsedAt: new Date().toISOString(),
    };
  }
}

export default EwayBillParser;
