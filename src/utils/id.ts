import { randomBytes, randomUUID } from 'node:crypto';
import { customAlphabet } from 'nanoid/non-secure';

const UPPERCASE_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SESSION_ID_ALPHABET = `${UPPERCASE_LETTERS}${UPPERCASE_LETTERS.toLowerCase()}${DIGITS}`;
const SESSION_ID_LENGTH = 16;

const sessionIdGenerator = customAlphabet(SESSION_ID_ALPHABET, SESSION_ID_LENGTH);

// Makes a short, URL-friendly session id (16 random letters/digits) —
// short and typeable since it ends up in the shareable session link.
export function generateSessionId(): string {
  return sessionIdGenerator();
}

// Makes a high-entropy secret token for the session admin to prove their
// identity with — 32 random bytes as a 64-character hex string, not a
// formatted id, since it's compared as a bearer secret, not looked up.
export function generateAdminToken(): string {
  return randomBytes(32).toString('hex');
}

// Makes a standard UUID for a participant. Never shown in a URL and doesn't
// need to be short or typeable, so a plain UUID is the simplest fit.
export function generateParticipantId(): string {
  return randomUUID();
}
