const crypto = require('crypto');

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/jpg'
];

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png'];

const validateFile = (file) => {
    if (!file) {
        throw new Error('No file provided');
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File size exceeds maximum limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`);
    }

    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        throw new Error(`Invalid file type. Allowed types: ${ALLOWED_MIME_TYPES.join(', ')}`);
    }

    const extension = file.originalname.substring(file.originalname.lastIndexOf('.')).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(extension)) {
        throw new Error(`Invalid file extension. Allowed extensions: ${ALLOWED_EXTENSIONS.join(', ')}`);
    }

    return true;
};

const computeSHA256Hash = (buffer) => {
    return crypto.createHash('sha256').update(buffer).digest('hex');
};

const sanitizeFileName = (originalName) => {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 8);
    const extension = originalName.substring(originalName.lastIndexOf('.')).toLowerCase();
    return `${timestamp}-${randomString}${extension}`;
};

module.exports = {
    validateFile,
    computeSHA256Hash,
    sanitizeFileName,
    MAX_FILE_SIZE_BYTES,
    ALLOWED_MIME_TYPES,
};

module.exports.default = module.exports;
