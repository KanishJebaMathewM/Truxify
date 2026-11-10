// backend/api/test/mocks/supabaseAuthMock.js
import { vi } from 'vitest';

export const mockSupabaseClient = {
  auth: {
    signInWithOtp: vi.fn().mockResolvedValue({
      data: { user: null, session: null },
      error: null,
    }),
    verifyOtp: vi.fn().mockResolvedValue({
      data: {
        user: { id: 'usr_mock_12345', phone: '+919876543210' },
        session: { access_token: 'mock-jwt-access-token-xyz' },
      },
      error: null,
    }),
    getUser: vi.fn().mockResolvedValue({
      data: {
        user: { id: 'usr_mock_12345', email: 'joshua.miracle@truxify.com' },
      },
      error: null,
    }),
  },
  from: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'usr_mock_12345' }, error: null }),
  })),
};

// Mock the `@supabase/supabase-js` package globally for integration suites
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));
