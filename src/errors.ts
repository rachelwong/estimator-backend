export const ERROR_HTTP_STATUS = {
  INVALID_NAME: 400,
  INVALID_SLIDER_MAX: 400,
  UNKNOWN_SESSION: 404,
  INVALID_ADMIN_TOKEN: 403,
  INVALID_SELECTION: 400,
  SESSION_ENDED: 409,
} as const;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
