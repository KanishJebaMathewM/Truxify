import { describe, it, expect } from 'vitest';
import { hashOtp } from '../../src/lib/otpHashing.js';

describe('otpHashing', () => {
  it('throws TypeError when OTP is null or empty', () => {
    expect(() => hashOtp('')).toThrow(TypeError);
    expect(() => hashOtp(null)).toThrow(TypeError);
  });
});
