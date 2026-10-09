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

const MIN_LATITUDE = -90;
const MAX_LATITUDE = 90;
const MIN_LONGITUDE = -180;
const MAX_LONGITUDE = 180;

/**
 * Builds a bounded coordinate schema.
 *
 * `z.coerce.number()` alone is unsafe for coordinates because
 * `Number(null) === 0` and `Number('') === 0`, so a missing value silently
 * becomes Null Island (0, 0) instead of failing validation. Blank strings and
 * nullish values are therefore rejected before coercion, and the result must
 * be finite and inside the valid WGS84 range.
 */
const coordinateSchema = (field, min, max) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return NaN;
      if (typeof value === 'string' && value.trim() === '') return NaN;
      return value;
    },
    z.coerce
      .number()
      .refine(Number.isFinite, { message: `${field} must be a finite number` })
      .min(min, { message: `${field} must be greater than or equal to ${min}` })
      .max(max, { message: `${field} must be less than or equal to ${max}` })
  );

const latitudeSchema = (field) =>
  coordinateSchema(field, MIN_LATITUDE, MAX_LATITUDE);

const longitudeSchema = (field) =>
  coordinateSchema(field, MIN_LONGITUDE, MAX_LONGITUDE);

/**
 * Positive money/weight amounts must also be finite: `.positive()` alone lets
 * `Infinity` through, which Postgres happily stores in a numeric column.
 */
const positiveFiniteNumber = (field, { max } = {}) => {
  let schema = z.coerce
    .number()
    .refine(Number.isFinite, { message: `${field} must be a finite number` })
    .positive({ message: `${field} must be greater than 0` });
  if (max !== undefined) {
    schema = schema.max(max, { message: `${field} must be less than or equal to ${max}` });
  }
  return schema;
};

export const createLoadSchema = z.object({
  origin: z.object({
    lat: latitudeSchema('origin.lat'),
    lng: longitudeSchema('origin.lng'),
    address: z.string().optional(),
  }),
  destination: z.object({
    lat: latitudeSchema('destination.lat'),
    lng: longitudeSchema('destination.lng'),
    address: z.string().optional(),
  }),
  weight_tons: positiveFiniteNumber('weight_tons', { max: 50 }),
  expected_price: positiveFiniteNumber('expected_price'),
  material_type: z.string().min(2).max(100).optional(),
});
