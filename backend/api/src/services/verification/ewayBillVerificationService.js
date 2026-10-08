import { DocumentIngestionPipeline } from './documentIngestionPipeline.js';
import { EwayBillParser } from './ewayBillParser.js';
import { FraudDuplicationGuard } from './fraudDuplicationGuard.js';
import { GstinClient } from './gstinClient.js';
import logger from '../../middleware/logger.js';

export class EwayBillVerificationService {
  constructor(options = {}) {
    this.ingestionPipeline = new DocumentIngestionPipeline(options);
    this.parser = new EwayBillParser(options);
    this.duplicationGuard = new FraudDuplicationGuard(options);
    this.gstinClient = new GstinClient(options);
  }

  /**
   * Complete end-to-end e-Way bill document verification.
   * 
   * @param {object} params
   * @param {Buffer} params.fileBuffer - Uploaded file content buffer
   * @param {string} [params.declaredMimeType] - Declared MIME type
   * @param {string|object} params.ocrOrQrPayload - OCR extracted text or QR code payload
   * @param {string} params.tripId - Freight Trip UUID
   * @param {string} [params.assignedVehicleNumber] - Vehicle registration assigned to trip
   * @returns {Promise<object>} Verification decision and structured metadata
   */
  async verifyEwayBill(params) {
    const {
      fileBuffer,
      declaredMimeType,
      ocrOrQrPayload,
      tripId,
      assignedVehicleNumber,
    } = params;

    const rejectionReasons = [];

    // 1. Ingestion, Anti-Virus & Content Hash
    const ingestionResult = await this.ingestionPipeline.processDocument(fileBuffer, declaredMimeType);

    // 2. Parse e-Way Bill Fields
    const parsedData = this.parser.parse(ocrOrQrPayload);

    if (!parsedData.validationFlags.isEwbFormatValid) {
      rejectionReasons.push(`Invalid e-Way Bill Number format: '${parsedData.ewayBillNumber || 'missing'}' (expected 12 digits)`);
    }

    if (parsedData.validationFlags.isExpired) {
      rejectionReasons.push(`e-Way Bill has expired (validity ended ${parsedData.validUntil})`);
    }

    // 3. Check for Duplication & Vehicle Mismatch
    const fraudResult = await this.duplicationGuard.evaluateDocumentUniqueness({
      tripId,
      ewayBillNumber: parsedData.ewayBillNumber,
      sha256Hash: ingestionResult.sha256Hash,
      assignedVehicleNumber,
      extractedVehicleNumber: parsedData.vehicleNumber,
    });

    if (!fraudResult.isApproved) {
      rejectionReasons.push(...fraudResult.fraudFlags);
    }

    // 4. Verify GSTIN Status on Government Network
    let supplierGstinInfo = null;
    if (parsedData.gstinSupplier) {
      supplierGstinInfo = await this.gstinClient.verifyTaxpayerStatus(parsedData.gstinSupplier);
      if (supplierGstinInfo.isBlocked) {
        rejectionReasons.push(`Supplier GSTIN '${parsedData.gstinSupplier}' is not active on GST portal (${supplierGstinInfo.status})`);
      }
    }

    const isVerified = rejectionReasons.length === 0;

    // 5. If verified, record in database
    if (isVerified) {
      await this.duplicationGuard.recordVerification({
        tripId,
        ewayBillNumber: parsedData.ewayBillNumber,
        sha256Hash: ingestionResult.sha256Hash,
        supplierGstin: parsedData.gstinSupplier,
        recipientGstin: parsedData.gstinRecipient,
        vehicleNumber: parsedData.vehicleNumber,
      });
    }

    const response = {
      isVerified,
      status: isVerified ? 'APPROVED' : 'REJECTED',
      rejectionReasons,
      documentDetails: {
        ewayBillNumber: parsedData.ewayBillNumber,
        supplierGstin: parsedData.gstinSupplier,
        supplierLegalName: supplierGstinInfo?.legalName || parsedData.consignorName,
        recipientGstin: parsedData.gstinRecipient,
        vehicleNumber: parsedData.vehicleNumber,
        hsnCode: parsedData.hsnCode,
        validUntil: parsedData.validUntil,
        sha256Hash: ingestionResult.sha256Hash,
        fileSizeBytes: ingestionResult.fileSizeBytes,
      },
      verifiedAt: new Date().toISOString(),
    };

    logger.info(
      { tripId, isVerified, ewayBillNumber: parsedData.ewayBillNumber },
      `[EwayBillVerificationService] e-Way bill verification finished (${response.status})`
    );

    return response;
  }
}

export default EwayBillVerificationService;
