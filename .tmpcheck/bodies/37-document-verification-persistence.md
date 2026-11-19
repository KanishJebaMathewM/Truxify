## Problem

`processDocumentUpload()` in `backend/api/src/services/documentVerificationService.js` writes `document_number`, `extracted_data`, `ocr_confidence`, `expiry_date`, `rejection_reason`, and `verified_at`, and uses status `'verified'`. The `driver_documents` table has none of the extra columns in the base schema, stores expiry in `valid_until`, requires `mime_type`, and its status constraint accepts only `pending_review`, `approved`, and `rejected`. The admin verification path also writes other missing fields.

## Root cause

The service was written against an assumed table shape. It also calls `upsert(..., { onConflict: 'driver_id,document_type' })`, but there is no unique constraint on those columns, so PostgREST cannot perform the conflict resolution even if the columns existed.

## Impact

- Every successful OCR verification fails at the database write, so drivers cannot become verified.
- Rejected and pending documents are never persisted, leaving compliance staff without a review queue.
- The admin override writes an invalid status and fails, blocking manual recovery.

## Proposed fix

- Add a migration for the OCR, rejection, and verifier metadata columns while keeping the existing status constraint.
- Persist `valid_until`, required `mime_type`, and map the public `verified` result to the stored `approved` status.
- Replace the unsupported upsert with an explicit lookup by driver/type, then update by ID or insert.
- Make the admin update report a missing document instead of silently succeeding.

## Verification

- Process a valid document and assert the row contains `approved`, `valid_until`, and `mime_type`.
- Process a rejected document and assert the rejection reason is stored with `rejected`.
- Run the document verification service tests and the migration syntax check.

Request: @Senthil455 please assign this issue.
