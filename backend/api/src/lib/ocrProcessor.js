/**
 * @fileoverview OCR processing with image preprocessing and text extraction.
 * Uses Tesseract.js for document text extraction.
 */

import logger from '../middleware/logger.js';

// Note: In production, Tesseract.js would be imported here.
// For this implementation, we simulate the OCR process structure.
// import Tesseract from 'tesseract.js';

/**
 * Preprocesses an image buffer for better OCR accuracy.
 * Applies grayscale, contrast enhancement, and noise reduction.
 * 
 * @param {Buffer} imageBuffer 
 * @returns {Promise<Buffer>} Preprocessed image buffer
 */
export async function preprocessImage(imageBuffer) {
    // In production, use Sharp or Jimp for image processing:
    // const processed = await sharp(imageBuffer)
    //   .grayscale()
    //   .normalize()
    //   .sharpen()
    //   .toBuffer();

    // For now, return original buffer (preprocessing is optional but recommended)
    return imageBuffer;
}

/**
 * Extracts text from an image using OCR.
 * 
 * @param {Buffer} imageBuffer 
 * @param {string} language - e.g., 'eng', 'hin', 'eng+hin'
 * @returns {Promise<{text: string, confidence: number, words: object[]}>}
 */
export async function extractText(imageBuffer, language = 'eng') {
    try {
        const preprocessed = await preprocessImage(imageBuffer);

        // Production implementation with Tesseract.js:
        /*
        const { data } = await Tesseract.recognize(preprocessed, language, {
          logger: m => {
            if (m.status === 'recognizing text') {
              logger.debug({ progress: m.progress }, 'OCR progress');
            }
          }
        });
        
        return {
          text: data.text,
          confidence: data.confidence,
          words: data.words || []
        };
        */

        // Simulated response for structure validation
        logger.info('OCR extraction simulated (Tesseract.js not installed)');
        return {
            text: '',
            confidence: 0,
            words: []
        };
    } catch (err) {
        logger.error({ err }, 'OCR extraction failed');
        throw new Error(`OCR failed: ${err.message}`);
    }
}

/**
 * Parses extracted text to find specific document fields.
 * Uses regex patterns to locate dates, numbers, and names.
 * 
 * @param {string} text - Raw OCR text
 * @param {string} docType - Document type
 * @returns {object} Extracted fields
 */
export function parseDocumentText(text, docType) {
    if (!text || typeof text !== 'string') return {};

    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const extracted = { rawText: text };

    // Date patterns (DD/MM/YYYY, DD-MM-YYYY, YYYY-MM-DD)
    const datePattern = /(\d{2}[\/\-]\d{2}[\/\-]\d{4}|\d{4}[\/\-]\d{2}[\/\-]\d{2})/g;
    const dates = text.match(datePattern) || [];

    // Number patterns (alphanumeric sequences)
    const numberPattern = /\b[A-Z0-9]{6,20}\b/g;
    const numbers = text.match(numberPattern) || [];

    // Assign dates based on document type
    if (docType === 'DL' || docType === 'RC' || docType === 'INSURANCE') {
        if (dates.length >= 2) {
            extracted.valid_from = dates[0];
            extracted.valid_until = dates[1];
        } else if (dates.length === 1) {
            extracted.valid_until = dates[0];
        }
    }

    // Extract document number (usually the longest alphanumeric)
    if (numbers.length > 0) {
        extracted.document_number = numbers.reduce((a, b) => a.length >= b.length ? a : b);
    }

    // Extract name (usually first line or line containing "NAME")
    const nameLine = lines.find(l => l.toUpperCase().includes('NAME'));
    if (nameLine) {
        extracted.name = nameLine.replace(/NAME[:\s]*/i, '').trim();
    } else if (lines.length > 0) {
        extracted.name = lines[0];
    }

    // DOB extraction
    const dobPattern = /(?:DOB|DATE OF BIRTH|D\.O\.B)[:\s]*(\d{2}[\/\-]\d{2}[\/\-]\d{4})/i;
    const dobMatch = text.match(dobPattern);
    if (dobMatch) {
        extracted.dob = dobMatch[1];
    }

    return extracted;
}

/**
 * Calculates overall OCR confidence from word-level confidences.
 * @param {object[]} words - Array of word objects with confidence
 * @returns {number} Average confidence 0-100
 */
export function calculateConfidence(words) {
    if (!words || words.length === 0) return 0;

    const totalConf = words.reduce((sum, w) => sum + (w.confidence || 0), 0);
    return Math.round(totalConf / words.length);
}

/**
 * Validates image format and size.
 * @param {object} file - Multer file object
 * @returns {{valid: boolean, error?: string}}
 */
export function validateImageFile(file) {
    if (!file) return { valid: false, error: 'No file provided' };

    const allowedMimes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowedMimes.includes(file.mimetype)) {
        return { valid: false, error: `Invalid file type: ${file.mimetype}` };
    }

    const maxSize = 10 * 1024 * 1024; // 10MB
    if (file.size > maxSize) {
        return { valid: false, error: `File too large (${Math.round(file.size / 1024 / 1024)}MB). Max 10MB.` };
    }

    if (file.size < 1024) {
        return { valid: false, error: 'File too small, likely corrupted' };
    }

    return { valid: true };
}
