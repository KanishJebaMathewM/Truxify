import { z } from 'zod';

const nonNegativeDecimalString = (field) => z
  .string({
    error: `${field} must be a single numeric string`,
  })
  .regex(/^(?:\d+|\d*\.\d+)$/, {
    message: `${field} must be a non-negative decimal number`,
  })
  .transform(Number)
  .refine(Number.isFinite, {
    message: `${field} must be a finite number`,
  });

export const loadFilterQuerySchema = z.object({
  min_price: nonNegativeDecimalString('min_price').optional(),
  max_price: nonNegativeDecimalString('max_price').optional(),
  distance: nonNegativeDecimalString('distance').optional(),
}).passthrough().superRefine((filters, ctx) => {
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
