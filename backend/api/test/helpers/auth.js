import jwt from 'jsonwebtoken';

// Read at CALL time — module-load capture raced suites that pin
// JWT_SECRET in their own setup (the token would be signed with the stale
// fallback and never verify).
function jwtSecret() {
  return process.env.JWT_SECRET || 'truxify-jwt-secret-key';
}

export function generateTestToken({ id, role = 'customer', ...claims } = {}) {
  return jwt.sign({ id, role, ...claims }, jwtSecret(), { expiresIn: '1h' });
}