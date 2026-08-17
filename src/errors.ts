export const ErrorCode = {
  InvalidName: 'INVALID_NAME',
  InvalidSliderMax: 'INVALID_SLIDER_MAX',
  UnknownSession: 'UNKNOWN_SESSION',
  InvalidAdminToken: 'INVALID_ADMIN_TOKEN',
  InvalidSelection: 'INVALID_SELECTION',
  SessionEnded: 'SESSION_ENDED',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.InvalidName]: 400,
  [ErrorCode.InvalidSliderMax]: 400,
  [ErrorCode.UnknownSession]: 404,
  [ErrorCode.InvalidAdminToken]: 403,
  [ErrorCode.InvalidSelection]: 400,
  [ErrorCode.SessionEnded]: 409,
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
