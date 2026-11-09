export function requireJsonContent(req, res, next) {
  // Only enforce on mutating requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];

    if (!contentType) {
      return res.status(415).json({
        error: 'Unsupported Media Type.',
        received: undefined,
        allowed: [
          'application/json',
          'application/x-www-form-urlencoded',
          'multipart/form-data',
        ],
      });
    }
// backend/api/test/unit/contentType.test.js

import { requireJsonContent } from '../../src/middleware/contentType.js';

describe('contentType middleware Unit Tests', () => {
  let req, res, next;

  beforeEach(() => {
    req = { headers: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  it('calls next() when Content-Type is application/json', () => {
    req.headers['content-type'] = 'application/json; charset=utf-8';

    requireJsonContent(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 415 status when Content-Type is missing or not application/json', () => {
    req.headers['content-type'] = 'text/plain';

    requireJsonContent(req, res, next);

    expect(res.status).toHaveBeenCalledWith(415);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.stringContaining('Unsupported Media Type'),
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});
    // Compare the base media type exactly (ignoring parameters such as
    // charset). A substring match previously let malformed values like
    // `text/plain; application/json` or `application/jsonx` through.
    const mimeType = contentType.split(';')[0].trim().toLowerCase();

    // Allow the media types the API actually parses (express.json,
    // express.urlencoded, multer for uploads). Anything else is rejected.
    const allowed = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ];
    if (allowed.includes(mimeType)) {
      // Validate that parsed body is a plain object (not array, null, or primitive)
      if (mimeType === 'application/json' && req.body != null) {
        if (typeof req.body !== 'object' || Array.isArray(req.body)) {
          return res.status(400).json({
            error: 'Request body must be a JSON object.',
          });
        }
      }
      return next();
    }

    // Reject all other content types
    return res.status(415).json({
      error: 'Unsupported Media Type.',
      received: mimeType,
      allowed,
    });
  }

  // Pass through for GET, DELETE, etc.
  next();
}
