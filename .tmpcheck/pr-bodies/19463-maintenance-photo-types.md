## Problem

The maintenance photo upload route in `backend/api/src/routes/maintenancePhotoRoutes.js` relies on the multer file filter. When every uploaded file is rejected, `req.files` is empty and the request continues into the handler. The handler then behaves as if a photo was supplied, producing an unclear failure or a partial database record.

## Change

- Add a `requireUploadedPhotos` middleware after multer that checks for a non-empty `req.files` array.
- Return 400 with the accepted JPEG and PNG types when no file was accepted.
- Apply it to the upload route before the controller.

## Verification

- Post only a text or PDF file and assert 400 with the supported-type message.
- Post a valid JPEG or PNG and assert the handler still runs.
- Run the maintenance photo route tests.

Closes #19463
