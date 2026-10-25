import { describe, expect, it, vi } from 'vitest';
import suspiciousRequests from '../../src/middleware/suspiciousRequests.js';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { warn: vi.fn() },
}));

function request(value, field = 'body') {
  const req = {
    headers: {}, body: {}, query: {}, originalUrl: '/api/orders',
    [field]: { note: value },
  };
  const res = { status: vi.fn(), json: vi.fn() };
  res.status.mockReturnValue(res);
  const next = vi.fn();
  suspiciousRequests(req, res, next);
  return { req, res, next };
}

const benignNotes = [
  'Main St -- Building C',
  'St. -- Road 5',
  '--foo',
  'abc -- 123',
  '2026-01-01--2026-02-01',
  'Driver said "-- take the left turn"',
];

describe.each(['body', 'query'])('benign comment markers in %s', (field) => {
  it.each(benignNotes)('accepts %s', (value) => {
    const { req, res, next } = request(value, field);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(req.threatFindings).toBeUndefined();
  });
});

it.each([
  "' OR 1=1 --",
  'UNION SELECT password FROM users --',
  'DROP TABLE profiles --',
  'INSERT INTO profiles VALUES (1)',
  'DELETE FROM profiles',
])('retains blocking for explicit SQL signatures: %s', (value) => {
  const { req, res, next } = request(value);
  expect(req.threatFindings).toContain('SQL Injection');
  expect(res.status).toHaveBeenCalledWith(403);
  expect(next).not.toHaveBeenCalled();
});
