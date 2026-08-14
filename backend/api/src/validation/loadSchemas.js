import { z } from 'zod';

const nonNegativeDecimalString = (field) => z
  .string({
    invalid_type_error: `${field} must be a single numeric string`,
  })
  .regex(/^(?:\d+|\d*\.\d+)$/, {
    message: `${field} must be a non-negative decimal number`,
  })
  .transform(Number)
  .refine(Number.isFinite, {
    message: `${field} must be a finite number`,
  });

export const loadFilterQuerySchema = z.object({
  // Repeated string params are allowed to reach the route, which rejects them
  // (or handles them) with its own, more specific error messages, preserving
  // the pre-validation behavior exactly.
  page: z.union([z.string(), z.array(z.string())]).optional(),
  limit: z.union([z.string(), z.array(z.string())]).optional(),
  status: z.union([z.string(), z.array(z.string())]).optional(),
  pickup_location: z.union([z.string(), z.array(z.string())]).optional(),
  destination: z.union([z.string(), z.array(z.string())]).optional(),
  goods_type: z.union([z.string(), z.array(z.string())]).optional(),
  vehicle_type: z.union([z.string(), z.array(z.string())]).optional(),
  min_price: nonNegativeDecimalString('min_price').optional(),
  max_price: nonNegativeDecimalString('max_price').optional(),
  distance: nonNegativeDecimalString('distance').optional().refine(v => v === undefined || v > 0, {
    message: 'distance must be a positive number',
  }),
  order: z.enum(['asc', 'desc']).optional(),
  sort_by: z.enum(['estimated_price', 'created_at', 'distance']).optional(),
}).superRefine((filters, ctx) => {
  if (
    filters.min_price !== undefined
    && filters.max_price !== undefined
    && filters.min_price > filters.max_price
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['min_price'],
      message: 'min_price must be less than or equal to max_price',
    });
  }
});

export const createLoadSchema = z.object({
  origin: z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
    address: z.string().optional(),
  }),
  destination: z.object({
    lat: z.coerce.number(),
    lng: z.coerce.number(),
    address: z.string().optional(),
  }),
  weight_tons: z.coerce.number().positive().max(50),
  expected_price: z.coerce.number().positive(),
  material_type: z.string().min(2).max(100).optional(),
});
