/**
 * @fileoverview Unit tests for PoD storage helpers.
 * Resolves Issue #10277: Verifies proper client usage and path generation.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    validatePodFile,
    generatePodStoragePath,
    POD_CONFIG
} from '../../../src/lib/storage/podStorage.js';

// Mock Supabase
vi.mock('../../../src/config/db.js', () => ({
    supabaseAdmin: {
        storage: {
            from: vi.fn(() => ({
                upload: vi.fn().mockResolvedValue({ data: { path: 'test/path.jpg' }, error: null }),
                createSignedUrl: vi.fn().mockResolvedValue({
                    data: { signedUrl: 'https://signed-url.com' },
                    error: null
                }),
                remove: vi.fn().mockResolvedValue({ error: null }),
                list: vi.fn().mockResolvedValue({ data: [], error: null })
            }))
        }
    },
    createUserClient: vi.fn((token) => ({
        storage: {
            from: vi.fn(() => ({
                upload: vi.fn().mockResolvedValue({ data: { path: 'test/path.jpg' }, error: null }),
                createSignedUrl: vi.fn().mockResolvedValue({
                    data: { signedUrl: 'https://signed-url-user.com' },
                    error: null
                })
            }))
        }
    }))
}));

describe('PoD Storage Helpers (#10277)', () => {
    describe('validatePodFile', () => {
        it('should accept valid JPEG image under size limit', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'image/jpeg',
                size: 1024,
                originalname: 'signature.jpg'
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(true);
        });

        it('should accept valid PNG image', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'image/png',
                size: 1024
            };

            const result = validatePodFile(file, 'photo');
            expect(result.valid).toBe(true);
        });

        it('should accept valid WebP image', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'image/webp',
                size: 1024
            };

            const result = validatePodFile(file, 'photo');
            expect(result.valid).toBe(true);
        });

        it('should accept PDF files', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'application/pdf',
                size: 1024
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(true);
        });

        it('should reject GIF images', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'image/gif',
                size: 1024
            };

            const result = validatePodFile(file, 'photo');
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/Invalid file type/i);
        });

        it('should reject SVG images (security risk)', () => {
            const file = {
                buffer: Buffer.alloc(1024),
                mimetype: 'image/svg+xml',
                size: 1024
            };

            const result = validatePodFile(file, 'photo');
            expect(result.valid).toBe(false);
        });

        it('should reject text files', () => {
            const file = {
                buffer: Buffer.from('hello world'),
                mimetype: 'text/plain',
                size: 11
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(false);
        });

        it('should reject signature files over 2MB', () => {
            const file = {
                buffer: Buffer.alloc(POD_CONFIG.SIGNATURE_MAX_BYTES + 1),
                mimetype: 'image/jpeg',
                size: POD_CONFIG.SIGNATURE_MAX_BYTES + 1
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/too large/i);
        });

        it('should reject photo files over 5MB', () => {
            const file = {
                buffer: Buffer.alloc(POD_CONFIG.PHOTO_MAX_BYTES + 1),
                mimetype: 'image/jpeg',
                size: POD_CONFIG.PHOTO_MAX_BYTES + 1
            };

            const result = validatePodFile(file, 'photo');
            expect(result.valid).toBe(false);
        });

        it('should accept signature file at exactly 2MB', () => {
            const file = {
                buffer: Buffer.alloc(POD_CONFIG.SIGNATURE_MAX_BYTES),
                mimetype: 'image/jpeg',
                size: POD_CONFIG.SIGNATURE_MAX_BYTES
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(true);
        });

        it('should reject null file', () => {
            const result = validatePodFile(null, 'signature');
            expect(result.valid).toBe(false);
        });

        it('should reject file without buffer', () => {
            const file = { mimetype: 'image/jpeg', size: 1024 };
            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(false);
        });

        it('should reject empty file', () => {
            const file = {
                buffer: Buffer.alloc(0),
                mimetype: 'image/jpeg',
                size: 0
            };

            const result = validatePodFile(file, 'signature');
            expect(result.valid).toBe(false);
            expect(result.error).toMatch(/empty/i);
        });
    });

    describe('generatePodStoragePath', () => {
        it('should generate path with correct format', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'signature',
                'test.jpg'
            );

            expect(path).toMatch(/^user-123\/pod_sig_order-456_\d+_[a-f0-9]+\.jpg$/);
        });

        it('should use pod_photo prefix for photo type', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo',
                'photo.png'
            );

            expect(path).toMatch(/^user-123\/pod_photo_order-456_/);
        });

        it('should preserve PNG extension', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo',
                'image.png'
            );

            expect(path).toMatch(/\.png$/);
        });

        it('should preserve WebP extension', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo',
                'image.webp'
            );

            expect(path).toMatch(/\.webp$/);
        });

        it('should preserve PDF extension', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'signature',
                'document.pdf'
            );

            expect(path).toMatch(/\.pdf$/);
        });

        it('should normalize jpeg to jpg extension', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo',
                'image.jpeg'
            );

            expect(path).toMatch(/\.jpg$/);
        });

        it('should default to jpg for unknown extensions', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo',
                'image.xyz'
            );

            expect(path).toMatch(/\.jpg$/);
        });

        it('should default to jpg when no original name provided', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order-456',
                'photo'
            );

            expect(path).toMatch(/\.jpg$/);
        });

        it('should generate unique paths for same inputs (random suffix)', () => {
            const path1 = generatePodStoragePath('user-123', 'order-456', 'photo');
            const path2 = generatePodStoragePath('user-123', 'order-456', 'photo');

            // Different timestamps + random suffix should produce different paths
            expect(path1).not.toBe(path2);
        });

        it('should sanitize malicious characters in userId', () => {
            const path = generatePodStoragePath(
                'user/../../../etc/passwd',
                'order-456',
                'photo'
            );

            expect(path).not.toContain('..');
            expect(path).not.toContain('/');  // Sanitized to empty or underscore
        });

        it('should sanitize malicious characters in orderId', () => {
            const path = generatePodStoragePath(
                'user-123',
                'order<script>',
                'photo'
            );

            expect(path).not.toContain('<');
            expect(path).not.toContain('>');
        });

        it('should throw when userId is missing', () => {
            expect(() => generatePodStoragePath(null, 'order', 'photo'))
                .toThrow(/userId, orderId, and type are required/);
        });

        it('should throw when orderId is missing', () => {
            expect(() => generatePodStoragePath('user', null, 'photo'))
                .toThrow(/userId, orderId, and type are required/);
        });

        it('should throw when type is missing', () => {
            expect(() => generatePodStoragePath('user', 'order', null))
                .toThrow(/userId, orderId, and type are required/);
        });

        it('should handle UUID format user IDs', () => {
            const uuid = '550e8400-e29b-41d4-a716-446655440000';
            const path = generatePodStoragePath(uuid, 'order-456', 'photo');

            expect(path.startsWith(uuid)).toBe(true);
        });
    });

    describe('POD_CONFIG constants', () => {
        it('should have correct bucket name', () => {
            expect(POD_CONFIG.BUCKET_NAME).toBe('driver-documents');
        });

        it('should have reasonable signature size limit', () => {
            expect(POD_CONFIG.SIGNATURE_MAX_BYTES).toBeGreaterThan(0);
            expect(POD_CONFIG.SIGNATURE_MAX_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
        });

        it('should have reasonable photo size limit', () => {
            expect(POD_CONFIG.PHOTO_MAX_BYTES).toBeGreaterThan(POD_CONFIG.SIGNATURE_MAX_BYTES);
            expect(POD_CONFIG.PHOTO_MAX_BYTES).toBeLessThanOrEqual(20 * 1024 * 1024);
        });

        it('should include common image types', () => {
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).toContain('image/jpeg');
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).toContain('image/png');
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).toContain('image/webp');
        });

        it('should NOT include dangerous MIME types', () => {
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).not.toContain('image/svg+xml');
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).not.toContain('application/x-executable');
            expect(POD_CONFIG.ALLOWED_MIME_TYPES).not.toContain('application/x-sh');
        });

        it('should have 7-day signed URL TTL', () => {
            expect(POD_CONFIG.SIGNED_URL_TTL_SECONDS).toBe(60 * 60 * 24 * 7);
        });
    });
});
