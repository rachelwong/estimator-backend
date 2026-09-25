import type { ZodError } from 'zod';
import { AppError, ErrorCode } from '../errors.js';
import { PARTICIPANT_NAME_PATTERN, REPEATED_SPACES_PATTERN } from './patterns.js';

const MAX_NAME_LENGTH = 20;

// Trims the ends and collapses runs of spaces, so stray whitespace is never
// what fails. What comes back is what gets validated and stored.
export function normalizeParticipantName(name: string): string {
  return name.trim().replace(REPEATED_SPACES_PATTERN, ' ');
}

// Turns a ZodError into one readable line, e.g.
// "adminName: Invalid input: expected string, received undefined".
// The frontend shows this message to the user.
export function formatZodError(error: ZodError): string {
  return error.issues
    .map((issue) =>
      issue.path.length > 0 ? `${issue.path.join('.')}: ${issue.message}` : issue.message,
    )
    .join('; ');
}

// Throws INVALID_NAME if the name doesn't match PARTICIPANT_NAME_PATTERN.
export function validateParticipantName(name: string): void {
  if (name.length > MAX_NAME_LENGTH || !PARTICIPANT_NAME_PATTERN.test(name)) {
    throw new AppError(
      ErrorCode.InvalidName,
      'name must be 1-20 letters, numbers or spaces, with no symbols',
    );
  }
}
