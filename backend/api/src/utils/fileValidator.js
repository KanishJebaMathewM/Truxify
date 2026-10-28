import crypto from 'crypto';

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg'
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff]);
const PDF_SIGNATURE = Buffer.from('%PDF-', 'ascii');

const EXTENSION_MIME_TYPES = {
    '.pdf': 'application/pdf',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
};

/**
 * Detects the file type from the first bytes of the buffer.
 *
 * The multipart MIME type and extension are supplied by the client and cannot
 * be trusted. The stored object is later served to reviewers, so the byte
 * signature must agree with both of them before the upload is accepted.
 *
 * @param {Buffer} buffer
 * @returns {string|null} detected MIME type, or null when the signature is unknown
 */
export const detectFileType = (buffer) => {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
        return null;
    }
    if (buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
        return 'image/png';
    }
    if (buffer.subarray(0, 3).equals(JPEG_SIGNATURE)) {
        return 'image/jpeg';
    }
    if (buffer.subarray(0, 5).equals(PDF_SIGNATURE)) {
        return 'application/pdf';
    }
    return null;
};

export const validateFile = (file) => {
    if (!file) {
        throw new Error('No file provided');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File size exceeds maximum limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(`Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    if (!file.originalname || typeof file.originalname !== 'string' || !file.originalname.includes('.')) {
        throw new Error('File name must include a supported extension');
    }

    const extension = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        throw new Error(`Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }

    if (!Buffer.isBuffer(file.buffer)) {
        throw new Error('File content is required for type validation');
    }

    const detectedType = detectFileType(file.buffer);
    if (!detectedType) {
        throw new Error('Unable to verify file content type from its signature');
    }

    const declaredType = file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype;
    const extensionType = EXTENSION_MIME_TYPES[extension];
    if (detectedType !== declaredType || detectedType !== extensionType) {
        throw new Error('File content does not match its declared MIME type and extension');
    }

    return true;
};

export const computeSHA256Hash = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

export const sanitizeFileName = (originalName) => {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(4).toString('hex');
    if (!originalName || typeof originalName !== 'string') {
        return `${timestamp}-${randomString}`;
    }
    const lastDot = originalName.lastIndexOf('.');
    if (lastDot === -1 || lastDot === originalName.length - 1) {
        return `${timestamp}-${randomString}`;
    }
    const rawExt = originalName.substring(lastDot).toLowerCase();
    const cleanExt = rawExt.replace(/[^a-z0-9.]/g, '');
    const validExt = /^\.[a-z0-9]+$/.test(cleanExt) ? cleanExt : '';
    return `${timestamp}-${randomString}${validExt}`;
};

export default {
    validateFile,
    detectFileType,
    computeSHA256Hash,
    sanitizeFileName,
    MAX_FILE_SIZE_BYTES,
    ALLOWED_MIME_TYPES,
};
