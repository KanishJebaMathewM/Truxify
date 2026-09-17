import hmacService from '../services/hmacService.js';

export const hmacAuth = (req, res, next) => {
  const signature = req.headers['x-hmac-signature'];
  const timestamp = req.headers['x-timestamp'];
  const nonce = req.headers['x-nonce'];

  if (!signature || !timestamp || !nonce) {
    return res.status(401).json({ error: 'Missing HMAC authentication headers' });
  }

  if (!hmacService.isTimestampValid(timestamp)) {
    return res.status(401).json({ error: 'Request timestamp expired or invalid' });
  }

  if (!hmacService.isNonceValid(nonce)) {
    return res.status(401).json({ error: 'Nonce already used (replay attack detected)' });
  }

  const payload = (req.method === 'GET' || req.method === 'DELETE')
    ? (req.originalUrl.split('?')[1] || '')
    : JSON.stringify(req.body);

  const isValid = hmacService.verifySignature(signature, payload, timestamp, nonce);

  if (!isValid) {
    return res.status(403).json({ error: 'Invalid HMAC signature' });
  }

  next();
};

export default hmacAuth;
