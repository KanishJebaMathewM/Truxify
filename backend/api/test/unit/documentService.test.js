import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    processDocumentUpload,
    getUserDocuments,
    getDocumentById,
    updateDocumentVerificationStatus,
    deleteDocumentRecord,
    ALLOWED_DOC_TYPES,
    setSupabaseClientForTesting,
    setR2StorageServiceForTesting,
    resetClients
} from '../../src/services/documentService.js';

describe('documentService - Driver Credentials & Verification State Machine', () => {
    let mockSupabase;
    let mockR2;

    beforeEach(() => {
        mockR2 = {
            uploadToR2: vi.fn().mockResolvedValue({
                success: true,
                publicUrl: 'https://r2.truxify.com/documents/u1/license/test.pdf',
                fileHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
                objectKey: 'documents/u1/license/test.pdf'
            }),
            deleteDocument: vi.fn().mockResolvedValue({ success: true })
        };

        mockSupabase = {
            from: vi.fn()
        };

        setR2StorageServiceForTesting(mockR2);
        setSupabaseClientForTesting(mockSupabase);
    });

    afterEach(() => {
        resetClients();
        vi.restoreAllMocks();
    });

    describe('processDocumentUpload', () => {
        const validFile = {
            buffer: Buffer.from('Commercial Driver License Mock'),
            originalname: 'license.pdf',
            mimetype: 'application/pdf',
            size: 1024
        };

        it('should successfully upload document and register DB row', async () => {
            const mockInsertBuilder = {
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { id: 'doc-123', verification_status: 'pending' },
                    error: null
                })
            };
            mockSupabase.from.mockReturnValue(mockInsertBuilder);

            const res = await processDocumentUpload('user-42', validFile, 'license');

            expect(res.success).toBe(true);
            expect(res.documentId).toBe('doc-123');
            expect(res.status).toBe('pending');
            expect(mockR2.uploadToR2).toHaveBeenCalledTimes(1);
            expect(mockInsertBuilder.insert).toHaveBeenCalledTimes(1);
        });

        it('should reject invalid document type', async () => {
            await expect(processDocumentUpload('user-42', validFile, 'invalid_passport'))
                .rejects
                .toThrow(`Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}`);
        });

        it('should rollback R2 upload when database insert fails', async () => {
            const mockInsertBuilder = {
                insert: vi.fn().mockReturnThis(),
                select: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Database constraint violation' }
                })
            };
            mockSupabase.from.mockReturnValue(mockInsertBuilder);

            await expect(processDocumentUpload('user-42', validFile, 'insurance'))
                .rejects
                .toThrow('Database insert failure: Database constraint violation');

            expect(mockR2.deleteDocument).toHaveBeenCalledWith('documents/u1/license/test.pdf');
        });
    });

    describe('getUserDocuments', () => {
        it('should retrieve list of documents for specified user', async () => {
            const mockQuery = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: [{ id: 'doc-1', document_type: 'license' }],
                    error: null
                })
            };
            mockSupabase.from.mockReturnValue(mockQuery);

            const result = await getUserDocuments('user-100');
            expect(result.success).toBe(true);
            expect(result.documents).toHaveLength(1);
            expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-100');
        });

        it('should throw when database query fails', async () => {
            const mockQuery = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockResolvedValue({
                    data: null,
                    error: { message: 'Postgres connection timeout' }
                })
            };
            mockSupabase.from.mockReturnValue(mockQuery);

            await expect(getUserDocuments('user-100'))
                .rejects
                .toThrow('Failed to retrieve documents: Postgres connection timeout');
        });
    });

    describe('getDocumentById', () => {
        it('should return document for matching owner', async () => {
            const mockQuery = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { id: 'doc-1', user_id: 'user-owner' },
                    error: null
                })
            };
            mockSupabase.from.mockReturnValue(mockQuery);

            const doc = await getDocumentById('user-owner', 'doc-1', false);
            expect(doc.id).toBe('doc-1');
            expect(mockQuery.eq).toHaveBeenCalledWith('user_id', 'user-owner');
        });

        it('should bypass user_id check when isAdmin is true', async () => {
            const mockQuery = {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { id: 'doc-1', user_id: 'user-another' },
                    error: null
                })
            };
            mockSupabase.from.mockReturnValue(mockQuery);

            const doc = await getDocumentById('admin-id', 'doc-1', true);
            expect(doc.id).toBe('doc-1');
            // eq called once for id, NOT for user_id
            expect(mockQuery.eq).toHaveBeenCalledTimes(1);
            expect(mockQuery.eq).toHaveBeenCalledWith('id', 'doc-1');
        });
    });

    describe('updateDocumentVerificationStatus - State Machine', () => {
        it('should allow valid transition from pending to verified', async () => {
            let callCount = 0;
            mockSupabase.from.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    // Fetch existing status
                    return {
                        select: vi.fn().mockReturnThis(),
                        eq: vi.fn().mockReturnThis(),
                        single: vi.fn().mockResolvedValue({
                            data: { id: 'doc-10', verification_status: 'pending' },
                            error: null
                        })
                    };
                }
                // Update status
                return {
                    update: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    select: vi.fn().mockReturnThis(),
                    single: vi.fn().mockResolvedValue({
                        data: { id: 'doc-10', verification_status: 'verified' },
                        error: null
                    })
                };
            });

            const res = await updateDocumentVerificationStatus('doc-10', 'verified', { reviewerId: 'admin-1' });
            expect(res.success).toBe(true);
            expect(res.previousStatus).toBe('pending');
            expect(res.newStatus).toBe('verified');
        });

        it('should disallow illegal state transition (e.g. pending directly to expired)', async () => {
            mockSupabase.from.mockReturnValue({
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                single: vi.fn().mockResolvedValue({
                    data: { id: 'doc-10', verification_status: 'pending' },
                    error: null
                })
            });

            await expect(updateDocumentVerificationStatus('doc-10', 'expired'))
                .rejects
                .toThrow("Illegal state transition from 'pending' to 'expired'");
        });
    });

    describe('deleteDocumentRecord', () => {
        it('should delete file from R2 and remove row from Supabase', async () => {
            let callCount = 0;
            mockSupabase.from.mockImplementation(() => {
                callCount++;
                if (callCount === 1) {
                    return {
                        select: vi.fn().mockReturnThis(),
                        eq: vi.fn().mockReturnThis(),
                        single: vi.fn().mockResolvedValue({
                            data: { id: 'doc-99', object_key: 'documents/u1/doc.pdf' },
                            error: null
                        })
                    };
                }
                return {
                    delete: vi.fn().mockReturnThis(),
                    eq: vi.fn().mockReturnThis(),
                    error: null
                };
            });

            const result = await deleteDocumentRecord('u1', 'doc-99');
            expect(result.success).toBe(true);
            expect(mockR2.deleteDocument).toHaveBeenCalledWith('documents/u1/doc.pdf');
        });
    });
});
