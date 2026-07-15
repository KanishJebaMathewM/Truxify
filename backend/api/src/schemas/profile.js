import { z } from 'zod';

export const VALID_LANGUAGES = ['en', 'hi', 'gu', 'mr', 'ta', 'te', 'kn', 'ml', 'bn', 'pa'];

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name must be 100 characters or fewer').optional(),
  language: z.string().min(2, 'Invalid language code').max(10, 'Invalid language code').optional(),
  dark_mode: z.boolean().optional(),
  is_online: z.boolean().optional(),
  phone: z.string().regex(/^\+?[\d\s\-()]{7,15}$/, 'Invalid phone number').optional(),
  email: z.string().email('Invalid email address').optional(),
  avatar_url: z.string().url('Invalid avatar URL').optional().nullable(),
}).strict();

export const profileQuerySchema = z.object({
  role: z.enum(['customer', 'driver', 'admin']).optional(),
  is_active: z.enum(['true', 'false']).transform(v => v === 'true').optional(),
  search: z.string().max(100).optional(),
  page: z.string().regex(/^\d+$/, 'page must be a positive integer')
    .transform(v => Math.max(1, Number(v))).optional(),
  limit: z.string().regex(/^\d+$/, 'limit must be a positive integer')
    .transform(v => Math.min(100, Math.max(1, Number(v)))).optional(),
});
