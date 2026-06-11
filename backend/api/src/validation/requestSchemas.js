import { z } from 'zod';

const coerceNumber = (schema) => z.preprocess(
  (val) => {
    if (val === undefined || val === null || val === '') {
      return undefined;
    }
    const num = Number(val);
    return isNaN(num) ? val : num;
  },
  schema
);

const latitudeSchema = coerceNumber(
  z.number({ invalid_type_error: "Latitude must be a number" })
    .min(-90, { message: 'Must be greater than or equal to -90' })
    .max(90, { message: 'Must be less than or equal to 90' })
);

const longitudeSchema = coerceNumber(
  z.number({ invalid_type_error: "Longitude must be a number" })
    .min(-180, { message: 'Must be greater than or equal to -180' })
    .max(180, { message: 'Must be less than or equal to 180' })
);

const isoDateStringSchema = z
  .string()
  .refine(value => /^\d{4}-\d{2}-\d{2}(?:T.*Z?)?$/.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO date string',
  });

const uuidSchema = z.string().uuid("Invalid ID format");
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/; // HH:MM or HH:MM:SS
const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export const createOrderSchema = z.object({
  pickup_address: z.string().min(5, "Pickup address is too short").max(255, "Pickup address is too long").optional(),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  drop_address: z.string().min(5, "Drop address is too short").max(255, "Drop address is too long").optional(),
  drop_lat: latitudeSchema,
  drop_lng: longitudeSchema,
  pickup_date: isoDateStringSchema,
  pickup_time: z.string().regex(timeRegex, "Time must be in HH:MM format").optional(),
  goods_type: z.string().min(2, "Goods type must be specified").optional(),
  weight_tonnes: coerceNumber(z.number().positive({ message: 'Must be greater than 0' }).max(100, "Weight exceeds maximum legal limits")),
  length_ft: coerceNumber(z.number().positive().max(60)).optional(),
  width_ft: coerceNumber(z.number().positive().max(15)).optional(),
  height_ft: coerceNumber(z.number().positive().max(15)).optional(),
  is_stackable: z.boolean().default(false).optional(),
  is_fragile: z.boolean().default(false).optional(),
  special_requirements: z.string().max(500).optional().nullable(),
  payment_method_id: z.string().optional(),
  upi_id: z.string().regex(upiRegex, "Invalid UPI ID format").optional().or(z.literal('')).nullable()
}).passthrough();

export const paramIdSchema = z.object({
  id: uuidSchema.or(z.string().min(1, "ID is required"))
});

export const submitBidSchema = z.object({
  bid_amount: z
    .number()
    .int({ message: 'Must be a positive integer' })
    .positive({ message: 'Must be greater than 0' }),
}).passthrough();

export const acceptBidParamsSchema = z.object({
  id: uuidSchema.or(z.string().min(1, "Order ID is required")),
  bidId: uuidSchema.or(z.string().min(1, "Bid ID is required"))
});

export const driverOnlineSchema = z.object({
  is_online: z.boolean(),
}).passthrough();

export const withdrawSchema = z.object({
  amount: z
    .number()
    .int({ message: 'Amount must be a whole number (paisa)' })
    .positive({ message: 'Amount must be greater than 0' })
    .safe({ message: 'Amount is too large' }),
}).passthrough();

export const submitRatingSchema = z.object({
  stars: z
    .number()
    .int({ message: 'Stars must be a whole number' })
    .min(1, { message: 'Stars must be between 1 and 5' })
    .max(5, { message: 'Stars must be between 1 and 5' }),
  comment: z.string().trim().max(1000, { message: 'Comment must be 1000 characters or fewer' }).optional().nullable(),
}).passthrough();

export const updateMilestoneSchema = z.object({
  milestone: z.enum(['Truck Assigned', 'En Route to Pickup', 'Goods Loaded', 'In Transit', 'Arriving', 'Delivered'], {
    invalid_type_error: 'Invalid milestone supplied.'
  })
});

export const verifyDeliverySchema = z.object({
  otp: z.preprocess(
    (val) => (val === undefined || val === null) ? undefined : String(val),
    z.string().regex(/^\d{6}$/, { message: 'OTP must be 6 digits' }).optional()
  )
});
