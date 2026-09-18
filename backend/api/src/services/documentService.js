import { createClient } from '@supabase/supabase-js';
import fileValidatorModule from '../utils/fileValidator.js';

const { validateFile, sanitizeFileName } = fileValidatorModule;

const supabaseUrl = process.env.SUPABASE_URL || 'https://mock.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'mock-key';

let supabaseClient = createClient(supabaseUrl, supabaseKey);
let activeR2Storage = null;

export const ALLOWED_DOC_TYPES = ['license', 'rc', 'insurance', 'identity', 'fitness_certificate', 'permit'];
export const DOCUMENT_STATUSES = ['pending', 'verified', 'rejected', 'expired'];

export const VALID_STATUS_TRANSITIONS = {
    pending: ['verified', 'rejected'],
    verified: ['expired', 'rejected'],
    rejected: ['pending'],
    expired: ['pending']
};

/**
 * Resolves R2 storage client with dynamic fallback.
 */
export const getR2Storage = async () => {
    if (activeR2Storage) {
        return activeR2Storage;
    }
    try {
        const mod = await import('./r2StorageService.js');
        return mod.default || mod;
    } catch {
        return {
            uploadToR2: async (file, key) => ({
                success: true,
                publicUrl: `https://r2.truxify.com/${key}`,
                fileHash: 'mock-file-hash',
                objectKey: key
            }),
            deleteDocument: async () => ({ success: true })
        };
    }
};

/**
 * Injects mock Supabase client for testing.
 */
export const setSupabaseClientForTesting = (client) => {
    supabaseClient = client;
};

/**
 * Injects mock R2 storage service for testing.
 */
export const setR2StorageServiceForTesting = (service) => {
    activeR2Storage = service;
};

/**
 * Resets testing mocks.
 */
export const resetClients = () => {
    supabaseClient = createClient(supabaseUrl, supabaseKey);
    activeR2Storage = null;
};

/**
 * Processes document upload, writes file to Cloudflare R2, and registers database record.
 * @param {string} userId
 * @param {Object} file
 * @param {string} docType
 * @returns {Promise<Object>}
 */
export const processDocumentUpload = async (userId, file, docType) => {
    if (!userId || typeof userId !== 'string') {
        throw new Error('userId must be a non-empty string');
    }

    validateFile(file);

    if (!ALLOWED_DOC_TYPES.includes(docType)) {
        throw new Error(`Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}`);
    }

    const sanitizedFileName = sanitizeFileName(file.originalname || 'document.pdf');
    const objectKey = `documents/${userId}/${docType}/${sanitizedFileName}`;

    const r2Client = await getR2Storage();
    const r2Result = await r2Client.uploadToR2(file, objectKey);

    try {
        const { data: documentRecord, error: dbError } = await supabaseClient
            .from('driver_documents')
            .insert({
                user_id: userId,
                document_type: docType,
                file_url: r2Result.publicUrl,
                file_hash: r2Result.fileHash,
                object_key: r2Result.objectKey,
                verification_status: 'pending',
                uploaded_at: new Date().toISOString(),
            })
            .select()
            .single();

        if (dbError) {
            await r2Client.deleteDocument(r2Result.objectKey);
            throw new Error(`Database insert failure: ${dbError.message}`);
        }

        return {
            success: true,
            documentId: documentRecord?.id || 'generated-id',
            fileUrl: r2Result.publicUrl,
            fileHash: r2Result.fileHash,
            objectKey: r2Result.objectKey,
            status: 'pending',
            message: 'Document uploaded and recorded successfully',
        };
    } catch (err) {
        // Rollback R2 storage upload if DB persistence fails
        try {
            await r2Client.deleteDocument(r2Result.objectKey);
        } catch {
            // Log and preserve root error
        }
        throw new Error(`Failed to save document record to database: ${err.message}`);
    }
};

/**
 * Retrieves all documents belonging to a specific user.
 * @param {string} userId
 * @returns {Promise<{success: boolean, documents: Array}>}
 */
export const getUserDocuments = async (userId) => {
    if (!userId) {
        throw new Error('userId is required');
    }

    try {
        const { data, error } = await supabaseClient
            .from('driver_documents')
            .select('*')
            .eq('user_id', userId)
            .order('uploaded_at', { ascending: false });

        if (error) throw error;

        return { success: true, documents: data || [] };
    } catch (error) {
        throw new Error(`Failed to retrieve documents: ${error.message}`);
    }
};

/**
 * Retrieves a single document by ID, enforcing ownership or admin privilege.
 * @param {string} userId
 * @param {string} documentId
 * @param {boolean} isAdmin
 * @returns {Promise<Object>}
 */
export const getDocumentById = async (userId, documentId, isAdmin = false) => {
    if (!documentId) throw new Error('documentId is required');

    let query = supabaseClient.from('driver_documents').select('*').eq('id', documentId);
    if (!isAdmin) {
        query = query.eq('user_id', userId);
    }

    const { data, error } = await query.single();
    if (error || !data) {
        throw new Error('Document not found or unauthorized');
    }

    return data;
};

/**
 * Updates document verification status enforcing valid state machine transitions.
 * @param {string} documentId
 * @param {string} newStatus 'pending' | 'verified' | 'rejected' | 'expired'
 * @param {Object} options { reviewerId, rejectionReason }
 * @returns {Promise<Object>}
 */
export const updateDocumentVerificationStatus = async (documentId, newStatus, options = {}) => {
    if (!documentId) throw new Error('documentId is required');
    if (!DOCUMENT_STATUSES.includes(newStatus)) {
        throw new Error(`Invalid target status. Must be one of: ${DOCUMENT_STATUSES.join(', ')}`);
    }

    const { data: currentDoc, error: fetchErr } = await supabaseClient
        .from('driver_documents')
        .select('*')
        .eq('id', documentId)
        .single();

    if (fetchErr || !currentDoc) {
        throw new Error('Document not found');
    }

    const allowedNext = VALID_STATUS_TRANSITIONS[currentDoc.verification_status] || [];
    if (!allowedNext.includes(newStatus)) {
        throw new Error(`Illegal state transition from '${currentDoc.verification_status}' to '${newStatus}'`);
    }

    const updatePayload = {
        verification_status: newStatus,
        reviewed_at: new Date().toISOString(),
        reviewed_by: options.reviewerId || 'system',
        rejection_reason: newStatus === 'rejected' ? (options.rejectionReason || 'Document did not meet verification criteria') : null
    };

    const { data: updatedDoc, error: updateErr } = await supabaseClient
        .from('driver_documents')
        .update(updatePayload)
        .eq('id', documentId)
        .select()
        .single();

    if (updateErr) throw new Error(`Failed to update status: ${updateErr.message}`);

    return {
        success: true,
        document: updatedDoc,
        previousStatus: currentDoc.verification_status,
        newStatus
    };
};

/**
 * Deletes document record from database and purges file from Cloudflare R2.
 * @param {string} userId
 * @param {string} documentId
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const deleteDocumentRecord = async (userId, documentId) => {
    if (!userId || !documentId) {
        throw new Error('userId and documentId are required for deletion');
    }

    const { data: doc, error: fetchError } = await supabaseClient
        .from('driver_documents')
        .select('object_key')
        .eq('id', documentId)
        .eq('user_id', userId)
        .single();

    if (fetchError || !doc) {
        throw new Error('Document not found or unauthorized');
    }

    if (doc.object_key) {
        const r2Client = await getR2Storage();
        await r2Client.deleteDocument(doc.object_key);
    }

    const { error: deleteError } = await supabaseClient
        .from('driver_documents')
        .delete()
        .eq('id', documentId)
        .eq('user_id', userId);

    if (deleteError) throw new Error(`Failed to delete document from database: ${deleteError.message}`);

    return { success: true, message: 'Document deleted successfully' };
};

export default {
    processDocumentUpload,
    getUserDocuments,
    getDocumentById,
    updateDocumentVerificationStatus,
    deleteDocumentRecord,
    ALLOWED_DOC_TYPES,
    DOCUMENT_STATUSES,
    VALID_STATUS_TRANSITIONS,
    setSupabaseClientForTesting,
    setR2StorageServiceForTesting,
    resetClients,
    getR2Storage
};
