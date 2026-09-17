const { createClient } = require('@supabase/supabase-js');
const r2StorageService = require('./r2StorageService');
const { validateFile, computeSHA256Hash, sanitizeFileName } = require('../utils/fileValidator');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const ALLOWED_DOC_TYPES = ['license', 'rc', 'insurance', 'identity'];

const processDocumentUpload = async (userId, file, docType) => {
    try {
        validateFile(file);

        if (!ALLOWED_DOC_TYPES.includes(docType)) {
            throw new Error(`Invalid document type. Allowed: ${ALLOWED_DOC_TYPES.join(', ')}`);
        }

        const sanitizedFileName = sanitizeFileName(file.originalname);
        const objectKey = `documents/${userId}/${docType}/${sanitizedFileName}`;

        const r2Result = await r2StorageService.uploadToR2(file, objectKey);

        const { data: documentRecord, error: dbError } = await supabase
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
            await r2StorageService.deleteDocument(r2Result.objectKey);
            throw new Error('Failed to save document record to database');
        }

        return {
            success: true,
            documentId: documentRecord.id,
            fileUrl: r2Result.publicUrl,
            fileHash: r2Result.fileHash,
            message: 'Document uploaded and recorded successfully',
        };
    } catch (error) {
        console.error('Document processing error:', error.message);
        throw error;
    }
};

const getUserDocuments = async (userId) => {
    try {
        const { data, error } = await supabase
            .from('driver_documents')
            .select('*')
            .eq('user_id', userId)
            .order('uploaded_at', { ascending: false });

        if (error) throw error;

        return { success: true, documents: data || [] };
    } catch (error) {
        console.error('Get documents error:', error.message);
        throw new Error('Failed to retrieve documents');
    }
};

const deleteDocumentRecord = async (userId, documentId) => {
    try {
        const { data: doc, error: fetchError } = await supabase
            .from('driver_documents')
            .select('object_key')
            .eq('id', documentId)
            .eq('user_id', userId)
            .single();

        if (fetchError || !doc) {
            throw new Error('Document not found or unauthorized');
        }

        await r2StorageService.deleteDocument(doc.object_key);

        const { error: deleteError } = await supabase
            .from('driver_documents')
            .delete()
            .eq('id', documentId)
            .eq('user_id', userId);

        if (deleteError) throw deleteError;

        return { success: true, message: 'Document deleted successfully' };
    } catch (error) {
        console.error('Delete document error:', error.message);
        throw new Error('Failed to delete document');
    }
};

module.exports = {
    processDocumentUpload,
    getUserDocuments,
    deleteDocumentRecord,
};
