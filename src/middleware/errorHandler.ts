import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, ERROR_HTTP_STATUS, ErrorCode } from '../errors.js';
import { formatZodError } from '../utils/validation.js';

// True for errors express.json() throws when a body is too large or isn't valid
// JSON. These are the client's fault, so they should be a 400, not a 500.
function isExposedClientError(err: unknown): err is { status: number; message: string } {
  if (typeof err !== 'object' || err === null) {
    return false;
  }
  const { status, expose } = err as { status?: unknown; expose?: unknown };
  return typeof status === 'number' && status >= 400 && status < 500 && expose === true;
}

// Express error middleware: translates a thrown AppError or ZodError into the
// { error, message } JSON shape, with status looked up from ERROR_HTTP_STATUS.
// Anything else is an unexpected bug — generic 500, no leaked internals.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    console.warn(`[${err.code}] ${err.message}`);
    res.status(ERROR_HTTP_STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }

  if (err instanceof ZodError || isExposedClientError(err)) {
    const message = err instanceof ZodError ? formatZodError(err) : err.message;
    console.warn(`[${ErrorCode.InvalidRequest}] ${message}`);
    res
      .status(ERROR_HTTP_STATUS[ErrorCode.InvalidRequest])
      .json({ error: ErrorCode.InvalidRequest, message });
    return;
  }

  console.error(`[${ErrorCode.InternalError}]`, err);
  res
    .status(ERROR_HTTP_STATUS[ErrorCode.InternalError])
    .json({ error: ErrorCode.InternalError, message: 'An unexpected error occurred' });
}
