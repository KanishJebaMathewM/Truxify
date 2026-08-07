import { z } from 'zod';
import { VALID_LANGUAGES } from '../schemas/profile.js';

// Generic field validation helpers
function isValidPhone(phone) {
  return /^\+?[\d\s\-()]{7,15}$/.test(phone);
}

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

export const uuidSchema = z.string().uuid("Invalid ID format");
const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/; // HH:MM or HH:MM:SS
const upiRegex = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

export const createOrderSchema = z.object({
  pickup_address: z.string().min(5, "Pickup address is too short").max(255, "Pickup address is too long"),
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  drop_address: z.string().min(5, "Drop address is too short").max(255, "Drop address is too long"),
  drop_lat: latitudeSchema,
  drop_lng: longitudeSchema,
  pickup_date: isoDateStringSchema.refine(val => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const parts = val.split('T')[0].split('-');
    if (parts.length === 3) {
      const year = parseInt(parts[0], 10);
      const month = parseInt(parts[1], 10) - 1;
      const day = parseInt(parts[2], 10);
      const localDate = new Date(year, month, day);
      return localDate >= today;
    }
    return new Date(val) >= today;
  }, {
    message: "Pickup date cannot be in the past",
  }),
  pickup_time: z.string().regex(timeRegex, "Time must be in HH:MM format").optional(),
  goods_type: z.string().min(2, "Goods type must be specified"),
  weight_tonnes: coerceNumber(z.number().positive({ message: 'Must be greater than 0' }).max(100, "Weight exceeds maximum legal limits")),
  length_ft: coerceNumber(z.number({ invalid_type_error: "Length must be a number" }).positive("Length must be greater than 0").max(60)).optional(),
  width_ft: coerceNumber(z.number({ invalid_type_error: "Width must be a number" }).positive("Width must be greater than 0").max(15)).optional(),
  height_ft: coerceNumber(z.number({ invalid_type_error: "Height must be a number" }).positive("Height must be greater than 0").max(15)).optional(),
  is_stackable: z.boolean().default(false).optional(),
  is_fragile: z.boolean().default(false).optional(),
  requires_refrigeration: z.boolean().default(false).optional(),
  target_temperature_min: coerceNumber(z.number()).optional(),
  target_temperature_max: coerceNumber(z.number()).optional(),
  special_requirements: z.string().max(500).optional().nullable(),
  payment_method_id: z.string().optional(),
  upi_id: z.string().regex(upiRegex, "Invalid UPI ID format").optional().or(z.literal('')).nullable(),
  waypoints: z.array(z.object({
    address: z.string().min(5, "Waypoint address is too short").max(255, "Waypoint address is too long"),
    lat: latitudeSchema,
    lng: longitudeSchema,
  })).optional(),
  // Server-computed fields — reject any client-supplied value to prevent price manipulation.
  base_freight: z.never().optional(),

  toll_estimate: z.never().optional(),
  platform_fee: z.never().optional(),
  total_amount: z.never().optional(),
  estimated_price: z.never().optional(),
}).strict();

export const paramIdSchema = z.object({
  id: z.string().min(1, "ID is required")
});

// Used to be UUID-only, but tests use string IDs like 'ticket-123', 'driver-1'
export const uuidParamSchema = z.object({
  id: z.string().min(1, "ID is required").optional(),
  driverId: z.string().min(1, "Driver ID is required").optional()
});

export const driverIdParamSchema = z.object({
  driverId: uuidSchema
});

export const submitBidSchema = z.object({
  bid_amount: z
    .number()
    .int({ message: 'Must be a positive integer' })
    .positive({ message: 'Must be greater than 0' }),
}).strict();

export const acceptBidParamsSchema = z.object({
  id: z.string().min(1, "Order ID is required"),
  bidId: z.string().min(1, "Bid ID is required")
});

export const driverOnlineSchema = z.object({
  is_online: z.boolean(),
}).strict();

export const withdrawSchema = z.object({
  amount: z
    .number()
    .int({ message: 'Amount must be a whole number (paisa)' })
    .positive({ message: 'Amount must be greater than 0' })
    .safe({ message: 'Amount must be a safe integer' }),
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
  metadata: z.record(z.any()).optional(),
}).strict();

export const unregisterDeviceSchema = z.object({
  fcmToken: z.string()
    .min(10, { message: 'fcmToken must be at least 10 characters' })
    .max(4096, { message: 'fcmToken is too long' }),
}).strict();

export const updateFcmTokenSchema = z.object({
  fcmToken: z.string()
    .min(10, { message: 'fcmToken must be at least 10 characters' })
    .max(4096, { message: 'fcmToken is too long' })
    .nullable(),
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
  status: z.string().min(1, 'Status cannot be empty').max(50, 'Status must be 50 characters or fewer').optional(),
}).strict();

export const createTicketCommentSchema = z.object({
  message: z.string().transform((v) => v.trim()).pipe(
    z.string().min(1, 'Message is required').max(1000, 'Message must be 1000 characters or fewer')
  )
}).strict();

export const driverStatementSchema = z.object({
  start_date: z.string().refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid date string',
  }).optional(),
  end_date: z.string().refine(value => !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid date string',
  }).optional(),
  format: z.enum(['json', 'csv']).optional(),
  sort_by: z.enum(['pickup_date', 'net_earnings', 'base_freight']).optional(),
}).strict();

/**
 * Reporting window for the driver earnings summary.
 *
 * `.strict()` rejects unknown query keys so a typo surfaces as a 400 rather
 * than silently falling back to the default period.
 */
export const earningsSummarySchema = z.object({
  period: z.enum(['weekly', 'monthly']).optional(),
}).strict();

// Indian vehicle registration plate: 2 letters, 2 digits, up to 3 letters, up to 4 digits
// e.g. MH12AB1234 or DL01C1234
const numberPlateRegex = /^[A-Z]{2}\d{2}[A-Z]{1,3}\d{1,4}$/;

export const otpSendSchema = z.object({
  phone: z.string().trim().min(10).max(20).refine(isValidPhone, {
    message: 'Phone must be a valid number (digits, optional +, spaces/dashes/parens)',
  }),
}).strict();

export const registerTruckSchema = z.object({
  name: z.string()
    .min(2, 'Truck name must be at least 2 characters')
    .max(100, 'Truck name must be 100 characters or fewer'),
  truck_type: z.enum(['Open Body', 'Closed Body', 'Container', 'Refrigerated'], {
    invalid_type_error: 'truck_type must be one of: Open Body, Closed Body, Container, Refrigerated',
  }),
  number_plate: z.string()
    .transform((v) => v.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
    .pipe(
      z.string().regex(numberPlateRegex, 'Invalid number plate format (e.g. MH12AB1234)')
    ),
  max_capacity_tons: z.number()
    .positive({ message: 'Capacity must be greater than 0' })
    .max(100, 'Capacity must be 100 tonnes or fewer'),
}).strict();

export const updateProfileSchema = z.object({
  full_name: z.string().trim().min(1, 'Name cannot be empty').max(100, 'Name must be 100 characters or fewer').optional(),
  company_name: z.string().trim().min(1, 'Company name cannot be empty').max(200, 'Company name must be 200 characters or fewer').optional(),
  phone: z.string().trim().refine(isValidPhone, { message: 'Phone must be a valid number (digits, optional +, spaces/dashes/parens)' }).optional(),
  email: z.string().trim().email('Invalid email address').optional(),
  number_plate: z.string().trim().optional(),
  language: z.string().min(2, 'Invalid language code').max(10, 'Invalid language code').refine((v) => VALID_LANGUAGES.includes(v), { message: 'Unsupported language code' }).optional(),
  dark_mode: z.boolean().optional(),
  is_online: z.boolean().optional(),
}).strict();

// ── Oracle & Verification schemas ───────────────────────────────────────

export const oracleConfirmSchema = z.object({
  orderId: uuidSchema,
  otp: z.string().regex(/^\d{6}$/, { message: 'OTP must be exactly 6 digits' }),
  gpsCoordinates: z.object({
    lat: latitudeSchema,
    lng: longitudeSchema,
  }),
}).strict();

export const oracleVerifyCrosschainSchema = z.object({
  orderId: uuidSchema,
  blockchainHash: z
    .string()
    .min(1, 'blockchainHash is required')
    .regex(/^0x[a-fA-F0-9]+$/, { message: 'blockchainHash must be a 0x-prefixed hex string' }),
}).strict();

export const verifyOrderParamsSchema = z.object({
  orderId: uuidSchema,
});

export const documentCheckSchema = z.object({
  driverId: uuidSchema,
}).strict();

// ── Deadhead matching schemas ──────────────────────────────────────────

const locationPointSchema = z.object({
  lat: latitudeSchema,
  lng: longitudeSchema,
});

const truckSpecsSchema = z.object({
  max_weight_kg: z.number().positive({ message: 'max_weight_kg must be > 0' }),
  max_length_m: z.number().positive({ message: 'max_length_m must be > 0' }),
  max_width_m: z.number().positive({ message: 'max_width_m must be > 0' }),
  max_height_m: z.number().positive({ message: 'max_height_m must be > 0' }),
});

const availableLoadSchema = z.object({
  load_id: z.string().min(1),
  origin_lat: latitudeSchema,
  origin_lng: longitudeSchema,
  dest_lat: latitudeSchema,
  dest_lng: longitudeSchema,
  weight_kg: z.number().positive(),
  length_m: z.number().positive(),
  width_m: z.number().positive(),
  height_m: z.number().positive(),
  pickup_deadline: isoDateStringSchema,
  payment_inr: z.number().positive(),
});

export const matchDeadheadSchema = z.object({
  driver_destination: locationPointSchema,
  truck_specs: truckSpecsSchema,
  arrival_time: isoDateStringSchema,
  available_loads: z.array(availableLoadSchema).min(1, 'At least one available load is required').max(50, 'Too many loads'),
}).strict();
// ── Public Order Tracking schemas ─────────────────────────────────────────

// ── Driver profit prediction schema ──────────────────────────────────────

export const predictDriverProfitSchema = z.object({
  route_distance_km: coerceNumber(
    z.number({ invalid_type_error: 'route_distance_km must be a number' })
      .positive({ message: 'route_distance_km must be greater than 0' })
  ),
  fuel_price_per_litre: coerceNumber(
    z.number({ invalid_type_error: 'fuel_price_per_litre must be a number' })
      .positive({ message: 'fuel_price_per_litre must be greater than 0' })
  ),
  toll_estimate_inr: coerceNumber(
    z.number({ invalid_type_error: 'toll_estimate_inr must be a number' })
      .nonnegative({ message: 'toll_estimate_inr must be >= 0' })
  ),
  truck_mileage_kml: coerceNumber(
    z.number({ invalid_type_error: 'truck_mileage_kml must be a number' })
      .positive({ message: 'truck_mileage_kml must be greater than 0' })
  ),
  cargo_weight_kg: coerceNumber(
    z.number({ invalid_type_error: 'cargo_weight_kg must be a number' })
      .positive({ message: 'cargo_weight_kg must be greater than 0' })
  ),
  trip_duration_hours: coerceNumber(
    z.number({ invalid_type_error: 'trip_duration_hours must be a number' })
      .positive({ message: 'trip_duration_hours must be greater than 0' })
  ),
}).strict();

export const shareTrackingSchema = z.object({}).strict();

export const publicTrackingTokenSchema = z.object({
  token: z.string().min(1, 'Tracking token is required').max(512),
});
