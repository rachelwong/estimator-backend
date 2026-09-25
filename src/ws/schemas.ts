import { z } from 'zod';

// Checks what clients send over the socket. TypeScript types don't exist at
// runtime, so a client could send anything. These match ClientToServerEvents
// in events.ts.
export const JoinPayloadSchema = z.string();

export const AdminAuthPayloadSchema = z.string();

export const SelectSquarePayloadSchema = z
  .object({ time: z.number(), resource: z.number() })
  .strict();

export const EndSessionPayloadSchema = z.string();
