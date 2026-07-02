# Implementation Specification: Issue #1495 - KYC Document Validation

## Problem
Driver KYC document uploads are not validated server-side. Executable files (.exe, .sh, .bat) are accepted as identity documents.

## Implementation Details

### Backend Changes (Node.js)

**File: `backend/api/src/services/kyc.service.js`**

Add validation function before document storage:

```javascript
// Add to imports
const fileType = require('file-type');
const mime = require('mime-types');

// Add validation method
async validateKYCDocument(file) {
  const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'application/pdf'];
  const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];
  const MAX_SIZE = 5 * 1024 * 1024; // 5MB

  // 1. File size check
  if (file.size > MAX_SIZE) {
    throw new Error('Document exceeds 5MB limit');
  }

  // 2. Extension check
  const ext = require('path').extname(file.originalname).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error('Invalid file extension');
  }

  // 3. MIME type check
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    throw new Error('Invalid MIME type');
  }

  // 4. Magic number validation (file signature)
  const type = await fileType.fromBuffer(file.buffer);
  if (!type || !ALLOWED_MIMES.includes(type.mime)) {
    throw new Error('File content does not match extension');
  }

  return true;
}
```

**File: `backend/api/src/routes/kyc.routes.js`**

Update upload endpoint:

```javascript
router.post('/upload', async (req, res) => {
  try {
    // Validate document first
    await kycService.validateKYCDocument(req.file);
    
    // Then save to storage
    const docPath = await kycService.saveDocument(req.file);
    
    // Log validation event
    await auditLog.create({
      userId: req.user.id,
      action: 'KYC_DOCUMENT_UPLOADED',
      status: 'SUCCESS'
    });
    
    res.json({ success: true, path: docPath });
  } catch (error) {
    await auditLog.create({
      userId: req.user.id,
      action: 'KYC_DOCUMENT_UPLOAD_FAILED',
      error: error.message
    });
    res.status(400).json({ error: error.message });
  }
});
```

### Testing

**File: `backend/api/test/kyc.test.js`**

Add test cases:
- Test 1: Reject .exe file → should fail
- Test 2: Reject file > 5MB → should fail
- Test 3: Accept valid PDF → should pass
- Test 4: Reject file with mismatched extension/content → should fail

## Closes #1495
