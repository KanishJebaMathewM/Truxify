import { z } from 'zod';

const coordinateSchema = z
  .number()
  .min(-180, { message: 'Must be greater than or equal to -180' })
  .max(180, { message: 'Must be less than or equal to 180' });

const isoDateStringSchema = z
  .string()
  .refine(value => /^\d{4}-\d{2}-\d{2}(?:T.*Z?)?$/.test(value) && !Number.isNaN(Date.parse(value)), {
    message: 'Must be a valid ISO date string',
  });

export const createOrderSchema = z.object({
  pickup_lat: coordinateSchema,
  pickup_lng: coordinateSchema,
  drop_lat: coordinateSchema,
  drop_lng: coordinateSchema,
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
