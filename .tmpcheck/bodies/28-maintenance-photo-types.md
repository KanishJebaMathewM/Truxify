## Problem

The maintenance photo upload route in `backend/api/src/routes/maintenancePhotoRoutes.js` relies on the multer file filter. When every uploaded file is rejected, `req.files` is empty and the request continues into the handler. The handler then behaves as if a photo was supplied, producing an unclear failure or a partial database record.

## Root cause

The route has no middleware that requires at least one accepted file. The multer filter rejects individual files, but Express does not automatically turn an empty accepted-file list into a 400.

## Impact

- A request containing only unsupported file types can create a maintenance record with no photo evidence.
- Clients receive a generic downstream error instead of a clear supported-type message.
- Repeated empty uploads can leave orphaned records and consume handler work.

## Proposed fix

- Add a `requireUploadedPhotos` middleware after multer that checks for a non-empty `req.files` array.
- Return 400 with the accepted JPEG and PNG types when no file was accepted.
- Apply it to the upload route before the controller.

## Verification

- Post only a text or PDF file and assert 400 with the supported-type message.
- Post a valid JPEG or PNG and assert the handler still runs.
- Run the maintenance photo route tests.

Request: @Senthil455 please assign this issue.
