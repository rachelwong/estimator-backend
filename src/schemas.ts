import { z } from 'zod';
import { PointSystemType } from './types.js';

export const CreateSessionRequestSchema = z.object({
  adminName: z.string().min(1),
  pointSystemType: z.enum([PointSystemType.Numerical, PointSystemType.Fibonacci]),
  sliderMax: z.number(),
});

const PointSystemSchema = z
  .object({
    type: z.enum([PointSystemType.Numerical, PointSystemType.Fibonacci]),
    sliderMax: z.number(),
    axisValues: z.array(z.number()),
  })
  .strict();

export const CreateSessionResponseSchema = z
  .object({
    sessionId: z.string(),
    adminToken: z.string(),
    adminParticipantId: z.string(),
    adminName: z.string(),
    pointSystem: PointSystemSchema,
  })
  .strict();

const RevealSquareSchema = z
  .object({
    time: z.number(),
    resource: z.number(),
    names: z.array(z.string()),
  })
  .strict();

const RevealPayloadSchema = z
  .object({
    squares: z.array(RevealSquareSchema),
    abstained: z.array(z.string()),
  })
  .strict();

export const GetSessionResponseSchema = z
  .object({
    sessionId: z.string(),
    pointSystem: PointSystemSchema,
    ended: z.boolean(),
    reveal: RevealPayloadSchema.optional(),
  })
  .strict();

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
    message: z.string(),
  })
  .strict();
