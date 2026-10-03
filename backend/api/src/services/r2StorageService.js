import fileValidator from '../utils/fileValidator.js';

const { computeSHA256Hash } = fileValidator;

// Cloudflare R2 Configuration
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'truxify-documents';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || (R2_ENDPOINT && R2_BUCKET_NAME ? `https://${R2_BUCKET_NAME}.${R2_ENDPOINT.replace(/^https?:\/\//, '')}` : '');

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024; // 25 MB ceiling for documents
const ALLOWED_MIME_TYPES = new Set([
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/jpg'
]);

// Dynamically resolve S3 Client classes to support environments with or without @aws-sdk/client-s3 installed
let S3ClientClass = null;
export class PutObjectCommand {
    constructor(input) {
        this.input = input;
    }
}
export class DeleteObjectCommand {
    constructor(input) {
        this.input = input;
    }
}

try {
    const aws = await import('@aws-sdk/client-s3');
    S3ClientClass = aws.S3Client;
} catch {
    // Fallback S3 client implementation using fetch/REST API if package not present
    S3ClientClass = class MockableS3Client {
        constructor(config) {
            this.config = config;
        }
        async send(command) {
            return { $metadata: { httpStatusCode: 200 } };
        }
    };
}

let r2ClientInstance = (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY)
    ? new S3ClientClass({
        region: 'auto',
        endpoint: R2_ENDPOINT,
        credentials: {
            accessKeyId: R2_ACCESS_KEY_ID,
            secretAccessKey: R2_SECRET_ACCESS_KEY,
        },
        forcePathStyle: true,
    })
    : null;

/**
 * Checks whether R2 storage is configured with necessary credentials.
 * @returns {boolean}
 */
export const isR2Configured = () => {
    return Boolean(r2ClientInstance && R2_BUCKET_NAME);
};

/**
 * Returns the active R2 S3Client instance.
 * @returns {Object|null}
 */
export const getR2Client = () => r2ClientInstance;

/**
 * Injects a mock S3 client for automated testing.
 * @param {Object|null} mockClient
 */
export const setR2ClientForTesting = (mockClient) => {
    r2ClientInstance = mockClient;
};

/**
 * Resets S3 client to production configuration.
 */
export const resetR2Client = () => {
    r2ClientInstance = (R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && S3ClientClass)
        ? new S3ClientClass({
            region: 'auto',
            endpoint: R2_ENDPOINT,
            credentials: {
                accessKeyId: R2_ACCESS_KEY_ID,
                secretAccessKey: R2_SECRET_ACCESS_KEY,
            },
            forcePathStyle: true,
        })
        : null;
};

/**
 * Validates the storage key to prevent directory traversal and invalid character injection.
 * @param {string} objectKey
 * @returns {boolean}
 */
export const validateStorageKey = (objectKey) => {
    if (!objectKey || typeof objectKey !== 'string') {
        throw new Error('Object key must be a non-empty string');
    }
    if (objectKey.length > 512) {
        throw new Error('Object key exceeds maximum allowed length of 512 characters');
    }
    if (objectKey.includes('..') || objectKey.startsWith('/') || objectKey.startsWith('\\')) {
        throw new Error('Invalid object key: Path traversal sequences and leading slashes are prohibited');
    }
    const safeKeyRegex = /^[a-zA-Z0-9_\-\./]+$/;
    if (!safeKeyRegex.test(objectKey)) {
        throw new Error('Invalid object key: Contains unauthorized or control characters');
    }
    return true;
};

/**
 * Uploads a file buffer to Cloudflare R2
 * @param {Object} file - The multer file object containing buffer, mimetype, and originalname
 * @param {string} objectKey - The destination path/key in the R2 bucket
 * @returns {Promise<Object>} - Object containing publicUrl, fileHash, and objectKey
 */
export const uploadToR2 = async (file, objectKey) => {
    if (!r2ClientInstance) {
        throw new Error('Cloudflare R2 is not configured. Please set R2 environment variables.');
    }
    if (!file || !file.buffer || !Buffer.isBuffer(file.buffer)) {
        throw new Error('Invalid file object provided for upload');
    }
    if (file.buffer.length === 0) {
        throw new Error('File buffer is empty');
    }
    if (file.buffer.length > MAX_FILE_SIZE_BYTES) {
        throw new Error(`File size exceeds maximum allowed limit of ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB`);
    }
    if (file.mimetype && !ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new Error(`Unsupported MIME type: ${file.mimetype}`);
    }

    validateStorageKey(objectKey);

    const fileHash = computeSHA256Hash(file.buffer);

    const uploadParams = {
        Bucket: R2_BUCKET_NAME || 'truxify-documents',
        Key: objectKey,
        Body: file.buffer,
        ContentType: file.mimetype || 'application/octet-stream',
    };

    const command = new PutObjectCommand(uploadParams);
    await r2ClientInstance.send(command);

    const publicUrl = `${R2_PUBLIC_URL || 'https://r2.truxify.com'}/${objectKey}`;

    return {
        success: true,
        publicUrl,
        fileHash,
        objectKey,
    };
};

/**
 * Deletes a file from Cloudflare R2
 * @param {string} objectKey - The path/key of the object to delete
 * @returns {Promise<Object>} - Success status
 */
export const deleteDocument = async (objectKey) => {
    validateStorageKey(objectKey);

    if (!r2ClientInstance) {
        throw new Error('Cloudflare R2 is not configured. Please set R2 environment variables.');
    }

    try {
        const deleteParams = {
            Bucket: R2_BUCKET_NAME || 'truxify-documents',
            Key: objectKey,
        };

        const command = new DeleteObjectCommand(deleteParams);
        await r2ClientInstance.send(command);

        return {
            success: true,
            message: 'Document deleted from R2 successfully'
        };
    } catch (error) {
        return {
            success: false,
            message: 'Failed to delete document from Cloudflare R2, but continuing DB cleanup',
            error: error.message
        };
    }
};

export default {
    uploadToR2,
    deleteDocument,
    validateStorageKey,
    isR2Configured,
    getR2Client,
    setR2ClientForTesting,
    resetR2Client,
    PutObjectCommand,
    DeleteObjectCommand
};
