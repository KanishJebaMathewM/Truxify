## Problem

`findExpiringDocuments()` and `getExpiredDocuments()` in `backend/api/src/lib/expiryTracker.js` query `expiry_date` and `alert_sent_30_days`/`alert_sent_7_days`/`alert_sent_1_days`, none of which exist on `driver_documents`. They also filter on status `'verified'` instead of the stored `'approved'`. The scheduled job therefore fails its queries and never sends expiry or compliance alerts.

## Change

- Query `valid_until` and status `approved` in both the expiring and expired paths.
- Add a migration for the three alert flags, `last_alert_sent_at`, and the supporting expiry index.
- Check the Supabase update error and refuse to mark alerts as sent when no send function is supplied.

## Verification

- Seed approved documents at 30, 7, and 1 days and assert each threshold is selected once.
- Seed a past-expiry document and assert it appears in the expired list and compliance result.
- Run the expiry tracker tests, including the failing-sender retry case.

Closes #19473
