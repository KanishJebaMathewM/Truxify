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
  pickup_address: z.string().min(5, "Pickup address is too short").max(255, "Pickup address is too long"),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  drop_address: z.string().min(5, "Drop address is too short").max(255, "Drop address is too long"),
  drop_lat: latitudeSchema,
  drop_lng: longitudeSchema,
  pickup_date: isoDateStringSchema,
  pickup_time: z.string().regex(timeRegex, "Time must be in HH:MM format").optional(),
  goods_type: z.string().min(2, "Goods type must be specified"),
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
  id: uuidSchema
});

export const submitBidSchema = z.object({
  bid_amount: z
    .number()
    .int({ message: 'Must be a positive integer' })
    .positive({ message: 'Must be greater than 0' }),
}).strict();

export const acceptBidParamsSchema = z.object({
  id: uuidSchema.or(z.string().min(1, "Order ID is required")),
  bidId: uuidSchema.or(z.string().min(1, "Bid ID is required"))
});

export const driverOnlineSchema = z.object({
  is_online: z.boolean(),
}).strict();

export const withdrawSchema = z.object({
  amount: z
    .number()
    .int({ message: 'Amount must be a whole number (paisa)' })
    .positive({ message: 'Amount must be greater than 0' })
    .safe({ message: 'Amount is too large' }),
}).strict();

export const submitRatingSchema = z.object({
  stars: z
    .number()
    .int({ message: 'Stars must be a whole number' })
    .min(1, { message: 'Stars must be between 1 and 5' })
    .max(5, { message: 'Stars must be between 1 and 5' }),
  comment: z.string().trim().max(1000, { message: 'Comment must be 1000 characters or fewer' }).optional().nullable(),
}).strict();
export const predictDemandSchema = z.object({
  hour: z.number().min(0).max(23, { message: 'Hour must be between 0 and 23' }),
  day_of_week: z.number().min(0).max(6, { message: 'Day of week must be between 0 and 6' }),
  temperature: z.number(),
  precipitation: z.number().nonnegative({ message: 'Precipitation must be greater than or equal to 0' }),
  historical_volume: z.number().nonnegative({ message: 'Historical volume must be greater than or equal to 0' }),
  nearby_drivers: z.number().nonnegative({ message: 'Nearby drivers must be greater than or equal to 0' }),
}).strict();

export const updateMilestoneSchema = z.object({
  milestone: z.enum(['Truck Assigned', 'En Route to Pickup', 'Arrived at Pickup', 'Goods Loaded', 'In Transit', 'Arriving', 'Delivered'], {
    invalid_type_error: 'Invalid milestone supplied.'
  })
});

export const verifyDeliverySchema = z.object({
  otp: z.preprocess(
    (val) => (val === undefined || val === null) ? undefined : String(val),
    z.string().regex(/^\d{6}$/, { message: 'OTP must be 6 digits' })
  )
});

export const changeDropSchema = z.object({
  drop_address: z.string().min(3, 'Drop address must be at least 3 characters'),
  drop_lat: coerceNumber(
    z.number({ invalid_type_error: 'Latitude must be a number' })
      .min(-90, { message: 'Must be greater than or equal to -90' })
      .max(90, { message: 'Must be less than or equal to 90' })
  ),
  drop_lng: coerceNumber(
    z.number({ invalid_type_error: 'Longitude must be a number' })
      .min(-180, { message: 'Must be greater than or equal to -180' })
      .max(180, { message: 'Must be less than or equal to 180' })
  ),
});

export const cancelOrderSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
}).strict();

export const updateWalletSchema = z.object({
  wallet_address: z.string().regex(
    /^0x[a-fA-F0-9]{40}$/,
    'Must be a valid 0x-prefixed 42-character wallet address'
  ),
}).strict();

export const registerDeviceSchema = z.object({
  fcmToken: z.string()
    .min(10, { message: 'fcmToken must be at least 10 characters' })
    .max(4096, { message: 'fcmToken is too long' }),
  platform: z.enum(['android', 'ios', 'web'], {
    invalid_type_error: 'platform must be one of: android, ios, web',
  }).default('android'),
}).strict();

export const createTicketSchema = z.object({
  subject: z.string().transform((v) => v.trim()).pipe(
    z.string().min(1, 'Subject is required').max(200, 'Subject must be 200 characters or fewer')
  ),
  category: z.string().transform((v) => v.trim()).pipe(
    z.string().min(1, 'Category is required').max(50, 'Category must be 50 characters or fewer')
  ),
  description: z.string().max(5000, 'Description must be 5000 characters or fewer').optional(),
}).strict();

export const updateTicketSchema = z.object({
  subject: z.string().min(1, 'Subject cannot be empty').max(200, 'Subject must be 200 characters or fewer').optional(),
  category: z.string().min(1, 'Category cannot be empty').max(50, 'Category must be 50 characters or fewer').optional(),
  description: z.string().max(5000, 'Description must be 5000 characters or fewer').optional(),
  status: z.enum(['open', 'in_progress', 'resolved', 'closed'], {
    invalid_type_error: "Status must be one of: open, in_progress, resolved, closed",
  }).optional(),
}).strict();


// Indian vehicle registration plate: 2 letters, 2 digits, up to 3 letters, up to 4 digits
// e.g. MH12AB1234 or DL01C1234
const numberPlateRegex = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$/;

export const registerTruckSchema = z.object({
  name: z.string()
    .min(2, 'Truck name must be at least 2 characters')
    .max(100, 'Truck name must be 100 characters or fewer'),
  number_plate: z.string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(
      z.string().regex(numberPlateRegex, 'Invalid number plate format (e.g. MH12AB1234)')
    ),
  max_capacity_tons: z.number()
    .positive({ message: 'Capacity must be greater than 0' })
    .max(100, 'Capacity must be 100 tonnes or fewer'),
}).strict();
