import type { ZodError } from 'zod';
import { AppError, ErrorCode } from '../errors.js';
import {
  PARTICIPANT_NAME_PATTERN,
  REPEATED_SPACES_PATTERN,
  WHITESPACE_RUN_PATTERN,
} from './patterns.js';

const MAX_NAME_LENGTH = 20;
const MAX_DESCRIPTION_LENGTH = 300;

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

// Trims the ends and collapses every whitespace run to one space, so the
// description is always one line. Blank becomes null. Throws
// INVALID_DESCRIPTION when it's too long — the message states the rule and
// never echoes the text, so user input stays out of the logs.
export function normalizeDescription(description?: string): string | null {
  const normalized = (description ?? '').trim().replace(WHITESPACE_RUN_PATTERN, ' ');
  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new AppError(
      ErrorCode.InvalidDescription,
      `description must be at most ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }
  return normalized === '' ? null : normalized;
}
