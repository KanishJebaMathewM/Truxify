# Proof of Delivery (PoD) Upload Architecture

## Overview
The PoD upload system allows drivers to attach signature images and delivery photos to completed orders. These artifacts gate escrow release and provide audit trails for dispute resolution.

**Issue #10277 Resolution**: Previously, the PoD endpoint used the shared anon-key Supabase client, which had no INSERT policy on the private `driver-documents` bucket, causing all uploads to fail with 401/403. This fix switches to the authenticated user client.

## Storage Architecture

### Bucket: `driver-documents`
Private bucket with the following RLS policies:

| Operation | Role | Policy |
|-----------|------|--------|
| INSERT | `authenticated` | User can upload to their own folder (`{user_id}/*`) |
| SELECT | `authenticated` | Driver can read own files; Customer can read files for their orders |
| DELETE | `service_role` | Only backend can delete (e.g., on order cancellation) |
| ALL | `service_role` | Full access for backend operations |

### Storage Path Convention
```
{user_id}/pod_{type}_{order_id}_{timestamp}_{random}.{ext}
```

**Examples:**
- `550e8400-e29b-41d4/pod_sig_order-123_1694965200_a1b2c3.jpg`
- `550e8400-e29b-41d4/pod_photo_order-123_1694965201_d4e5f6.png`

### File Validation
| Type | Max Size | Allowed MIME Types |
|------|----------|-------------------|
| Signature | 2 MB | image/jpeg, image/png, image/webp, application/pdf |
| Photo | 5 MB | image/jpeg, image/png, image/webp, application/pdf |

**Security**: SVG files are explicitly blocked to prevent XSS via malicious SVG scripts.

## Client Selection Strategy

The `podStorage.js` module selects the appropriate Supabase client:

```javascript
// Priority order:
1. createUserClient(req.token)  // Authenticated user's token
2. supabaseAdmin                // Service role fallback
```

### Why This Matters

**Old (broken) flow:**
```javascript
// Used anon client - NO INSERT policy for anon role
const { data, error } = await supabase.storage
  .from('driver-documents')
  .upload(path, buffer);
// ❌ Always 401/403
```

**New (fixed) flow:**
```javascript
// Uses authenticated user's client - INSERT policy allows own-folder uploads
const client = createUserClient(req.token);
const { data, error } = await client.storage
  .from('driver-documents')
  .upload(path, buffer);
// ✅ Success
```

## URL Generation for Access

Since the bucket is private, stored paths cannot be used directly in `<img>` tags. The system generates signed URLs on-demand:

```javascript
const { url } = await createPodSignedUrl(
  'user-123/pod_sig_order-456_1694965200.jpg',
  60 * 60 * 24 * 7,  // 7 days
  req.token
);
```

### When Signed URLs Are Generated
1. **Order detail fetch**: Customer views order → signed URLs included for PoD images
2. **Driver history**: Driver views their completed orders → signed URLs
3. **Dispute evidence**: Admin views disputed order → signed URLs

## Access Control Matrix

| User Role | Can Upload | Can View Own | Can View Others |
|-----------|------------|--------------|-----------------|
| Driver | ✅ Own orders | ✅ | ❌ |
| Customer | ❌ | ✅ Orders they placed | ❌ |
| Admin | ❌ | ✅ | ✅ All |
| Anonymous | ❌ | ❌ | ❌ |

The `verifyPodAccess()` function enforces this matrix before any signed URL is issued.

## API Endpoints

### POST /api/orders/:id/pod (Driver only)
Upload PoD signature and/or photo.

**Request:**
```http
POST /api/orders/550e8400-e29b-41d4/pod
Authorization: Bearer <driver_jwt>
Content-Type: multipart/form-data

signature: (binary file)
photo: (binary file, optional)
```

**Response (200):**
```json
{
  "success": true,
  "order_id": "550e8400-e29b-41d4",
  "signature_url": "https://...signed-url...",
  "photo_url": "https://...signed-url..."
}
```

### GET /api/orders/:id/pod (Driver/Customer/Admin)
Retrieve PoD files with signed URLs.

**Response (200):**
```json
{
  "signature": {
    "path": "user-123/pod_sig_...",
    "url": "https://...signed-url...",
    "uploaded_at": "2026-09-17T10:00:00Z"
  },
  "photo": { ... }
}
```

## Implementation Example

```javascript
// In orderRoutes.js POD handler
import { 
  validatePodFile, 
  generatePodStoragePath, 
  uploadPodFile, 
  createPodSignedUrl 
} from '../lib/storage/podStorage.js';

router.post('/:id/pod', authenticate, upload.fields([
  { name: 'signature', maxCount: 1 },
  { name: 'photo', maxCount: 1 }
]), async (req, res) => {
  const orderId = req.params.id;
  const driverId = req.user.id;

  // Validate files
  const signatureFile = req.files?.signature?.[0];
  if (signatureFile) {
    const validation = validatePodFile(signatureFile, 'signature');
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }
  }

  // Upload signature (uses authenticated user client)
  if (signatureFile) {
    const sigPath = generatePodStoragePath(
      driverId, 
      orderId, 
      'signature', 
      signatureFile.originalname
    );
    
    const upload = await uploadPodFile({
      fileBuffer: signatureFile.buffer,
      storagePath: sigPath,
      mimeType: signatureFile.mimetype,
      userToken: req.token  // ← Critical: passes user's JWT
    });

    if (!upload.success) {
      return res.status(500).json({ error: 'Failed to upload signature' });
    }

    // Generate signed URL for response
    const { url } = await createPodSignedUrl(sigPath, 60*60*24*7, req.token);
    
    // Store path in order record (not the signed URL, which expires)
    await orderRepository.updateOrder(orderId, {
      pod_signature_url: sigPath  // Store path, generate URL on demand
    });
  }

  res.json({ success: true });
});
```

## Related Issues
- #10277 - PoD storage auth fix (this PR)
- #10235 - Similar anon-storage issue on maintenance-photos bucket
- #8445 - Escrow release gated on PoD

## Monitoring

Track these metrics:
- PoD upload success rate by client type
- Signed URL generation latency
- Storage usage per driver
- Failed access attempts (potential abuse)

