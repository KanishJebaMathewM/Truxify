# Document Content Validation

## Overview

The Truxify backend validates the actual content of driver KYC document uploads, not just the declared file extension or MIME type. The validator (`lib/documentValidation.js`) inspects the file's magic bytes to determine its real format.

---

## Location

```
backend/api/src/lib/documentValidation.js
```

---

## Allowed Types

| Detected content | MIME type |
|------------------|-----------|
| JPEG (`0xFF D8 FF`) | `image/jpeg` |
| PNG (`0x89 50 4E 47 ...`) | `image/png` |
| PDF (`%PDF`) | `application/pdf` |

---

## Behavior

- `detectDocumentMimeType(buffer)` returns the detected MIME type or `null`.
- `validateDocumentBuffer(buffer, declaredMimeType)`:
  - Throws `DocumentValidationError` when the content is not an allowed type.
  - Throws when a declared MIME type is supplied and disagrees with the detected content (a `.jpg` that is really a script).
  - Returns the verified MIME type on success.

A client renaming `photo.jpg` into `photo.png` is detected, because the magic bytes — not the filename — decide.

---

## Why It Exists

KYC documents are high-value targets: forged documents open the door to account takeover and payment fraud. Content inspection makes trivial spoofing (renaming a file) impossible, and the declared-vs-detected check catches polyglot uploads.

---

## Testing

Automated tests verify:

- Each allowed format is detected.
- Invalid content is rejected.
- Declared/detected mismatches are rejected.
- Empty and non-buffer inputs are rejected safely.
