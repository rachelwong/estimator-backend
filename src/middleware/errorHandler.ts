import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { AppError, ERROR_HTTP_STATUS, ErrorCode } from '../errors.js';

// Express error middleware: translates a thrown AppError or ZodError into the
// { error, message } JSON shape, with status looked up from ERROR_HTTP_STATUS.
// Anything else is an unexpected bug — generic 500, no leaked internals.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    console.warn(`[${err.code}] ${err.message}`);
    res.status(ERROR_HTTP_STATUS[err.code]).json({ error: err.code, message: err.message });
    return;
  }

  if (err instanceof ZodError) {
    console.warn(`[${ErrorCode.InvalidRequest}] ${err.message}`);
    res
      .status(ERROR_HTTP_STATUS[ErrorCode.InvalidRequest])
      .json({ error: ErrorCode.InvalidRequest, message: err.message });
    return;
  }

  console.error(`[${ErrorCode.InternalError}]`, err);
  res
    .status(ERROR_HTTP_STATUS[ErrorCode.InternalError])
    .json({ error: ErrorCode.InternalError, message: 'An unexpected error occurred' });
}
