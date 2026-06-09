import { z } from 'zod';

const latitudeSchema = z
  .number()
  .min(-90, { message: 'Must be greater than or equal to -90' })
  .max(90, { message: 'Must be less than or equal to 90' });

const longitudeSchema = z
  .number()
  .min(-180, { message: 'Must be greater than or equal to -180' })
  .max(180, { message: 'Must be less than or equal to 180' });

const isoDateStringSchema = z
  .string()
  .refine(value => /^\d{4}-\d{2}-\d{2}(?:T.*Z?)?$/.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO date string',
  });

export const createOrderSchema = z.object({
  pickup_lat: latitudeSchema,
  pickup_lng: longitudeSchema,
  drop_lat: latitudeSchema,
  drop_lng: longitudeSchema,
  weight_tonnes: z.number().positive({ message: 'Must be greater than 0' }),
  pickup_date: isoDateStringSchema,
}).passthrough();

export const submitBidSchema = z.object({
  bid_amount: z
    .number()
    .int({ message: 'Must be a positive integer' })
    .positive({ message: 'Must be greater than 0' }),
}).passthrough();

export const driverOnlineSchema = z.object({
  is_online: z.boolean(),
}).passthrough();
