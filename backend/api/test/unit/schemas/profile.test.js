import { describe, it, expect } from 'vitest';
import { updateProfileSchema } from '../../../src/schemas/profile.js';

describe('Profile Schemas', () => {
  it('validates updateProfileSchema object', () => {
    expect(updateProfileSchema).toBeDefined();
  });
});
