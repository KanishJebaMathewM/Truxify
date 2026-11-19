## Problem

`processDocumentUpload()` in `backend/api/src/services/documentVerificationService.js` writes `document_number`, `extracted_data`, `ocr_confidence`, `expiry_date`, `rejection_reason`, and `verified_at`, and uses status `'verified'`. The `driver_documents` table has none of the extra columns in the base schema, stores expiry in `valid_until`, requires `mime_type`, and its status constraint accepts only `pending_review`, `approved`, and `rejected`. The admin verification path also writes other missing fields.

## Change

- Add a migration for the OCR, rejection, and verifier metadata columns while keeping the existing status constraint.
- Persist `valid_until`, required `mime_type`, and map the public `verified` result to the stored `approved` status.
- Replace the unsupported upsert with an explicit lookup by driver/type, then update by ID or insert.
- Make the admin update report a missing document instead of silently succeeding.

## Verification

- Process a valid document and assert the row contains `approved`, `valid_until`, and `mime_type`.
- Process a rejected document and assert the rejection reason is stored with `rejected`.
- Run the document verification service tests and the migration syntax check.

Closes #19472
