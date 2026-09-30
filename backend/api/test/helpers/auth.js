import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'truxify-jwt-secret-key';

export function generateTestToken({ id, role = 'customer', ...claims } = {}) {
  return jwt.sign({ id, role, ...claims }, JWT_SECRET, { expiresIn: '1h' });
}