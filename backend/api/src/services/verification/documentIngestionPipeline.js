import crypto from 'crypto';
import logger from '../../middleware/logger.js';
import { validateDocumentBuffer, detectDocumentMimeType } from '../../lib/documentValidation.js';
import { scanBuffer } from '../../lib/malwareScanner.js';

export class DocumentIngestionPipeline {
  /**
   * @param {object} [options={}]
   * @param {number} [options.maxFileSizeBytes=15728640] - 15MB max file size
   */
  constructor(options = {}) {
    this.maxFileSizeBytes = options.maxFileSizeBytes || 15 * 1024 * 1024;
  }

  /**
   * Ingests, scans, and hashes an uploaded document buffer.
   * 
   * @param {Buffer} buffer - Raw file content buffer
   * @param {string} [declaredMimeType] - MIME type reported by client
   * @returns {Promise<{isValid: boolean, sha256Hash: string, detectedMimeType: string, fileSizeBytes: number}>}
   */
  async processDocument(buffer, declaredMimeType) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('Document buffer is empty or not a valid Buffer');
    }

    if (buffer.length > this.maxFileSizeBytes) {
      throw new Error(`File size (${buffer.length} bytes) exceeds maximum limit (${this.maxFileSizeBytes} bytes)`);
    }

    // 1. Magic Bytes Inspection
    const verifiedMime = validateDocumentBuffer(buffer, declaredMimeType);
    const detectedMimeType = detectDocumentMimeType(buffer) || verifiedMime;

    // 2. Malware & Antivirus Scan
    const scanResult = await scanBuffer(buffer);
    if (!scanResult.isClean) {
      logger.warn({ threat: scanResult.threat }, '[DocumentIngestionPipeline] Malware detected in upload');
      throw new Error(`Malware scan rejected file: ${scanResult.threat || 'Threat detected'}`);
    }

    // 3. SHA-256 Content Hash Calculation
    const sha256Hash = crypto.createHash('sha256').update(buffer).digest('hex');

    return {
      isValid: true,
      sha256Hash,
      detectedMimeType,
      fileSizeBytes: buffer.length,
      scannedAt: new Date().toISOString(),
    };
  }
}

export default DocumentIngestionPipeline;
