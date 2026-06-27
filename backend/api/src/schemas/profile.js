import { z } from 'zod';

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name must be 100 characters or fewer').optional(),
  language: z.string().min(2, 'Invalid language code').max(10, 'Invalid language code').optional(),
  dark_mode: z.boolean().optional(),
  is_online: z.boolean().optional(),
}).strict();
