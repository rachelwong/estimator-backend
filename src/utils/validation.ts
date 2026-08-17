import { AppError, ErrorCode } from '../errors.js';

// 1-20 letters/digits only — no spaces, punctuation, or other symbols.
const PARTICIPANT_NAME_PATTERN = /^[A-Za-z0-9]{1,20}$/;

// Throws INVALID_NAME if the name doesn't match the allowed pattern above.
export function validateParticipantName(name: string): void {
  if (!PARTICIPANT_NAME_PATTERN.test(name)) {
    throw new AppError(
      ErrorCode.InvalidName,
      'name must be 1-20 alphanumeric characters with no spaces',
    );
  }
}
