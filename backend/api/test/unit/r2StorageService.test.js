import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    uploadToR2,
    deleteDocument,
    validateStorageKey,
    isR2Configured,
    getR2Client,
    setR2ClientForTesting,
    resetR2Client
} from '../../src/services/r2StorageService.js';

describe('r2StorageService - Cloudflare R2 Cloud Storage Layer', () => {
    let mockSend;
    let mockClient;

    beforeEach(() => {
        mockSend = vi.fn().mockResolvedValue({ $metadata: { httpStatusCode: 200 } });
        mockClient = {
            send: mockSend
        };
        setR2ClientForTesting(mockClient);
    });

    afterEach(() => {
        resetR2Client();
        vi.restoreAllMocks();
    });

    describe('isR2Configured and getR2Client', () => {
        it('should return true when mockClient is set', () => {
            expect(isR2Configured()).toBe(true);
            expect(getR2Client()).toBe(mockClient);
        });

        it('should return false when client is null', () => {
            setR2ClientForTesting(null);
            expect(isR2Configured()).toBe(false);
            expect(getR2Client()).toBeNull();
        });
    });

    describe('validateStorageKey', () => {
        it('should accept well-formed storage keys', () => {
            expect(validateStorageKey('documents/user-123/license.pdf')).toBe(true);
            expect(validateStorageKey('ebol/2026/09/shipment-999.jpg')).toBe(true);
            expect(validateStorageKey('cargo_photos/pallet_1.png')).toBe(true);
        });

        it('should reject non-string or empty keys', () => {
            expect(() => validateStorageKey('')).toThrow('Object key must be a non-empty string');
            expect(() => validateStorageKey(null)).toThrow('Object key must be a non-empty string');
            expect(() => validateStorageKey(undefined)).toThrow('Object key must be a non-empty string');
            expect(() => validateStorageKey(12345)).toThrow('Object key must be a non-empty string');
        });

        it('should reject directory traversal patterns', () => {
            expect(() => validateStorageKey('../etc/passwd')).toThrow('Path traversal sequences and leading slashes are prohibited');
            expect(() => validateStorageKey('documents/../../secret.key')).toThrow('Path traversal sequences and leading slashes are prohibited');
            expect(() => validateStorageKey('/root/file.pdf')).toThrow('Path traversal sequences and leading slashes are prohibited');
            expect(() => validateStorageKey('\\windows\\system32')).toThrow('Path traversal sequences and leading slashes are prohibited');
        });

        it('should reject keys with illegal characters or control codes', () => {
            expect(() => validateStorageKey('documents/file;rm -rf')).toThrow('Contains unauthorized or control characters');
            expect(() => validateStorageKey('documents/file\x00.pdf')).toThrow('Contains unauthorized or control characters');
            expect(() => validateStorageKey('documents/file<script>.png')).toThrow('Contains unauthorized or control characters');
        });

        it('should reject keys exceeding 512 characters', () => {
            const longKey = 'documents/' + 'a'.repeat(510) + '.pdf';
            expect(() => validateStorageKey(longKey)).toThrow('exceeds maximum allowed length of 512 characters');
        });
    });

    describe('uploadToR2', () => {
        const validFile = {
            buffer: Buffer.from('PDF Mock Content For Bill of Lading'),
            mimetype: 'application/pdf',
            originalname: 'bol-document.pdf'
        };

        it('should successfully upload valid file buffer to R2', async () => {
            const result = await uploadToR2(validFile, 'documents/usr_1/bol-document.pdf');

            expect(result.success).toBe(true);
            expect(result.objectKey).toBe('documents/usr_1/bol-document.pdf');
            expect(result.fileHash).toBeTypeOf('string');
            expect(result.fileHash.length).toBe(64); // SHA-256 hex string
            expect(mockSend).toHaveBeenCalledTimes(1);

            const putCommandArg = mockSend.mock.calls[0][0];
            expect(putCommandArg.input.Key).toBe('documents/usr_1/bol-document.pdf');
            expect(putCommandArg.input.ContentType).toBe('application/pdf');
        });

        it('should throw error if R2 client is unconfigured', async () => {
            setR2ClientForTesting(null);
            await expect(uploadToR2(validFile, 'documents/test.pdf'))
                .rejects
                .toThrow('Cloudflare R2 is not configured');
        });

        it('should throw error if file is missing or lacks buffer', async () => {
            await expect(uploadToR2(null, 'documents/test.pdf'))
                .rejects
                .toThrow('Invalid file object provided for upload');

            await expect(uploadToR2({}, 'documents/test.pdf'))
                .rejects
                .toThrow('Invalid file object provided for upload');
        });

        it('should throw error if file buffer is empty', async () => {
            const emptyFile = { buffer: Buffer.alloc(0), mimetype: 'application/pdf' };
            await expect(uploadToR2(emptyFile, 'documents/test.pdf'))
                .rejects
                .toThrow('File buffer is empty');
        });

        it('should throw error if file size exceeds 25 MB ceiling', async () => {
            const hugeBuffer = {
                buffer: Buffer.alloc(26 * 1024 * 1024),
                mimetype: 'application/pdf'
            };
            await expect(uploadToR2(hugeBuffer, 'documents/test.pdf'))
                .rejects
                .toThrow('File size exceeds maximum allowed limit of 25 MB');
        });

        it('should reject unsupported MIME types', async () => {
            const maliciousFile = {
                buffer: Buffer.from('ELF binary content'),
                mimetype: 'application/x-executable'
            };
            await expect(uploadToR2(maliciousFile, 'documents/malware.exe'))
                .rejects
                .toThrow('Unsupported MIME type: application/x-executable');
        });

        it('should reject upload if objectKey contains traversal', async () => {
            await expect(uploadToR2(validFile, '../escaped.pdf'))
                .rejects
                .toThrow('Path traversal sequences');
        });
    });

    describe('deleteDocument', () => {
        it('should successfully delete an object from R2', async () => {
            const result = await deleteDocument('documents/usr_1/bol-document.pdf');
            expect(result.success).toBe(true);
            expect(result.message).toContain('deleted from R2 successfully');
            expect(mockSend).toHaveBeenCalledTimes(1);

            const deleteCommandArg = mockSend.mock.calls[0][0];
            expect(deleteCommandArg.input.Key).toBe('documents/usr_1/bol-document.pdf');
        });

        it('should throw if R2 is not configured', async () => {
            setR2ClientForTesting(null);
            await expect(deleteDocument('documents/test.pdf'))
                .rejects
                .toThrow('Cloudflare R2 is not configured');
        });

        it('fails closed instead of fabricating a client when the S3 SDK is missing', async () => {
            const saved = {
                endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
                keyId: process.env.R2_ACCESS_KEY_ID,
                secret: process.env.R2_SECRET_ACCESS_KEY,
            };
            process.env.CLOUDFLARE_R2_ENDPOINT = 'https://example.r2.cloudflarestorage.com';
            process.env.R2_ACCESS_KEY_ID = 'test-key-id';
            process.env.R2_SECRET_ACCESS_KEY = 'test-secret';

            vi.resetModules();
            vi.doMock('@aws-sdk/client-s3', () => {
                throw new Error('not installed');
            });

            try {
                const mod = await import('../../src/services/r2StorageService.js');
                expect(mod.isR2SdkAvailable()).toBe(false);
                expect(mod.getR2Client()).toBeNull();
                expect(mod.isR2Configured()).toBe(false);

                await expect(mod.uploadToR2({
                    buffer: Buffer.from('%PDF-1.7\n', 'ascii'),
                    mimetype: 'application/pdf',
                }, 'documents/test.pdf')).rejects.toThrow('is not available');

                await expect(mod.deleteDocument('documents/test.pdf'))
                    .rejects.toThrow('is not available');
            } finally {
                vi.doUnmock('@aws-sdk/client-s3');
                vi.resetModules();
                for (const [key, value] of Object.entries({
                    CLOUDFLARE_R2_ENDPOINT: saved.endpoint,
                    R2_ACCESS_KEY_ID: saved.keyId,
                    R2_SECRET_ACCESS_KEY: saved.secret,
                })) {
                    if (value === undefined) delete process.env[key];
                    else process.env[key] = value;
                }
            }
        });

        it('should reject deletion with invalid object key', async () => {
            await expect(deleteDocument('../../root/file.pdf'))
                .rejects
                .toThrow('Path traversal sequences');
        });

        it('should safely return success:false on S3 deletion error without throwing', async () => {
            mockSend.mockRejectedValueOnce(new Error('Networking timeout on S3 endpoint'));
            const result = await deleteDocument('documents/test.pdf');
            expect(result.success).toBe(false);
            expect(result.message).toContain('Failed to delete document from Cloudflare R2');
            expect(result.error).toContain('Networking timeout');
        });
    });
});
