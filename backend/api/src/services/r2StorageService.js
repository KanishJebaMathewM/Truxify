const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { computeSHA256Hash } = require('../utils/fileValidator');

// Cloudflare R2 Configuration
const R2_ENDPOINT = process.env.CLOUDFLARE_R2_ENDPOINT;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL || `https://${R2_BUCKET_NAME}.${R2_ENDPOINT.split('https://')[1]}`;

if (!R2_ENDPOINT || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY || !R2_BUCKET_NAME) {
    console.warn('Warning: Cloudflare R2 environment variables are not fully configured. R2 uploads will fail.');
}

// Initialize S3 Client for Cloudflare R2
const r2Client = new S3Client({
    region: 'auto', // R2 uses 'auto' for region
    endpoint: R2_ENDPOINT,
    credentials: {
        accessKeyId: R2_ACCESS_KEY_ID,
        secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // Required for some R2 configurations
});

/**
 * Uploads a file buffer to Cloudflare R2
 * @param {Object} file - The multer file object containing buffer, mimetype, and originalname
 * @param {string} objectKey - The destination path/key in the R2 bucket
 * @returns {Promise<Object>} - Object containing publicUrl, fileHash, and objectKey
 */
const uploadToR2 = async (file, objectKey) => {
    try {
        if (!file || !file.buffer) {
            throw new Error('Invalid file object provided for upload');
        }

        // Compute SHA-256 hash of the file buffer before uploading
        const fileHash = computeSHA256Hash(file.buffer);

        // Prepare the PutObject command for R2
        const uploadParams = {
            Bucket: R2_BUCKET_NAME,
            Key: objectKey,
            Body: file.buffer,
            ContentType: file.mimetype,
            // Optional: Add Cache-Control or other metadata if needed
            // CacheControl: 'public, max-age=31536000', 
        };

        const command = new PutObjectCommand(uploadParams);
        await r2Client.send(command);

        // Construct the public URL for the uploaded object
        const publicUrl = `${R2_PUBLIC_URL}/${objectKey}`;

        return {
            success: true,
            publicUrl,
            fileHash,
            objectKey,
        };
    } catch (error) {
        console.error('R2 upload error:', error);
        throw new Error('Failed to upload document to Cloudflare R2');
    }
};

/**
 * Deletes a file from Cloudflare R2
 * @param {string} objectKey - The path/key of the object to delete
 * @returns {Promise<Object>} - Success status
 */
const deleteDocument = async (objectKey) => {
    try {
        if (!objectKey) {
            throw new Error('Object key is required for deletion');
        }

        const deleteParams = {
            Bucket: R2_BUCKET_NAME,
            Key: objectKey,
        };

        const command = new DeleteObjectCommand(deleteParams);
        await r2Client.send(command);

        return {
            success: true,
            message: 'Document deleted from R2 successfully'
        };
    } catch (error) {
        console.error('R2 delete error:', error);
        // We do not throw here to prevent DB deletion from failing if the file is already gone
        return {
            success: false,
            message: 'Failed to delete document from Cloudflare R2, but continuing DB cleanup'
        };
    }
};

module.exports = {
    uploadToR2,
    deleteDocument,
};
