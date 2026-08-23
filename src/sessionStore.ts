import { AppError, ErrorCode } from './errors.js';
import { computeAxisValues } from './pointSystems.js';
import type {
  Participant,
  PointSystemType,
  RevealPayload,
  RevealSquare,
  Selection,
  SessionState,
} from './types.js';
import { generateAdminToken, generateParticipantId, generateSessionId } from './utils/id.js';
import { validateParticipantName } from './utils/validation.js';

const sessions = new Map<string, SessionState>();

// Trims stray whitespace off a raw name, validates it, then capitalizes it
// (first letter upper, rest lower) so every stored name is display-ready.
function formatName(name: string): string {
  const trimmed = name.trim();
  validateParticipantName(trimmed);
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
}

// Checks whether any current participant already has this name, ignoring case.
function isNameTaken(session: SessionState, candidateName: string): boolean {
  return Array.from(session.participants.values()).some(
    (participant) => participant.name.toLowerCase() === candidateName.toLowerCase(),
  );
}

// Finds a free display name for a new participant: uses the plain name if it's
// free, otherwise tries "name-1", "name-2", ... until it finds one that's not
// already taken by an existing (including orphaned) participant.
function makeUniqueName(session: SessionState, baseName: string): string {
  if (!isNameTaken(session, baseName)) {
    return baseName;
  }
  let suffix = 1;
  let candidateName = `${baseName}-${suffix}`;
  while (isNameTaken(session, candidateName)) {
    suffix += 1;
    candidateName = `${baseName}-${suffix}`;
  }
  return candidateName;
}

// Looks up a session by id, or throws UNKNOWN_SESSION if it doesn't exist.
function getSessionOrThrow(sessionId: string): SessionState {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new AppError(ErrorCode.UnknownSession, `No session found with id "${sessionId}"`);
  }
  return session;
}

interface CreateSessionInput {
  adminName: string;
  pointSystemType: PointSystemType;
  sliderMax: number;
}

// Creates a brand-new session: validates the admin's name and point-system
// settings, generates a unique session id plus an admin token, and registers
// the admin as the session's first participant.
export function createSession({
  adminName,
  pointSystemType,
  sliderMax,
}: CreateSessionInput): SessionState {
  const normalizedAdminName = formatName(adminName);
  const axisValues = computeAxisValues(pointSystemType, sliderMax);

  let sessionId = generateSessionId();
  while (sessions.has(sessionId)) {
    sessionId = generateSessionId();
  }

  const adminParticipantId = generateParticipantId();
  const admin: Participant = {
    id: adminParticipantId,
    name: normalizedAdminName,
    selection: null,
    isAdmin: true,
  };

  const participants = new Map<string, Participant>();
  participants.set(adminParticipantId, admin);

  const session: SessionState = {
    id: sessionId,
    adminToken: generateAdminToken(),
    adminParticipantId,
    pointSystem: { type: pointSystemType, sliderMax, axisValues },
    participants,
    ended: false,
    createdAt: new Date(),
    endedAt: null,
  };

  sessions.set(sessionId, session);
  return session;
}

// Plain lookup for a session by id — returns undefined instead of throwing
// if it doesn't exist, leaving the "not found" decision to the caller.
export function getSession(sessionId: string): SessionState | undefined {
  return sessions.get(sessionId);
}

// Adds a new (non-admin) participant to a session: rejects if the session has
// already ended, otherwise normalizes/validates the name, de-duplicates it
// against existing participants, and stores the new participant.
export function addParticipant(sessionId: string, name: string): Participant {
  const session = getSessionOrThrow(sessionId);
  if (session.ended) {
    throw new AppError(ErrorCode.SessionEnded, `Session "${sessionId}" has already ended`);
  }

  const normalizedName = formatName(name);
  const uniqueParticipantName = makeUniqueName(session, normalizedName);

  const participant: Participant = {
    id: generateParticipantId(),
    name: uniqueParticipantName,
    selection: null,
    isAdmin: false,
  };

  session.participants.set(participant.id, participant);
  return participant;
}

// Records (or clears) a participant's vote. Rejects if the session has ended
// or the {time, resource} pair isn't a real square on this point system.
// Voting the same square again deselects it; voting a different square
// overwrites the previous choice. This overwrite is also how two admin tabs
// (both authenticated to the same adminParticipantId, since admin-auth never
// mints a per-socket identity) end up last-write-wins with no live sync
// between them — intentional, not a bug (decision #20).
export function selectSquare(
  sessionId: string,
  participantId: string,
  time: number,
  resource: number,
): void {
  const session = getSessionOrThrow(sessionId);
  if (session.ended) {
    throw new AppError(ErrorCode.SessionEnded, `Session "${sessionId}" has already ended`);
  }

  const { axisValues } = session.pointSystem;
  if (!axisValues.includes(time) || !axisValues.includes(resource)) {
    throw new AppError(
      ErrorCode.InvalidSelection,
      `{time: ${time}, resource: ${resource}} is not a valid square for this point system`,
    );
  }

  const participant = session.participants.get(participantId);
  if (!participant) {
    throw new Error(`No participant found with id "${participantId}" in session "${sessionId}"`);
  }

  const currentSelection = participant.selection;
  const isSameSelection =
    currentSelection !== null &&
    currentSelection.time === time &&
    currentSelection.resource === resource;
  participant.selection = isSameSelection ? null : ({ time, resource } satisfies Selection);
}

// Confirms the given token is the session's real admin token, throwing
// UNKNOWN_SESSION or INVALID_ADMIN_TOKEN as appropriate; returns the session
// on success so callers don't need a second lookup.
export function validateAdminToken(sessionId: string, adminToken: string): SessionState {
  const session = getSessionOrThrow(sessionId);
  if (session.adminToken !== adminToken) {
    throw new AppError(ErrorCode.InvalidAdminToken, 'Invalid admin token');
  }
  return session;
}

// Ends a session (idempotently): always re-checks the admin token first, then
// marks the session ended and computes the reveal on the first call. A second
// call returns the same reveal with wasAlreadyEnded: true instead of re-ending it.
export function endSession(
  sessionId: string,
  adminToken: string,
): { reveal: RevealPayload; wasAlreadyEnded: boolean } {
  const session = validateAdminToken(sessionId, adminToken);

  if (session.ended) {
    return { reveal: computeReveal(session), wasAlreadyEnded: true };
  }

  session.ended = true;
  session.endedAt = new Date();
  return { reveal: computeReveal(session), wasAlreadyEnded: false };
}

// Builds the reveal payload for a session: groups participants who voted by
// the exact square they picked, and lists everyone with no vote as abstained.
export function computeReveal(session: SessionState): RevealPayload {
  const squaresByKey = new Map<string, RevealSquare>();
  const abstained: string[] = [];

  for (const participant of session.participants.values()) {
    if (!participant.selection) {
      abstained.push(participant.name);
      continue;
    }

    const { time, resource } = participant.selection;
    const squareKey = `${time}:${resource}`;
    const square = squaresByKey.get(squareKey);
    if (square) {
      square.names.push(participant.name);
    } else {
      squaresByKey.set(squareKey, { time, resource, names: [participant.name] });
    }
  }

  return { squares: Array.from(squaresByKey.values()), abstained };
}

// Test-only: wipes every session so each test starts from a clean store.
export function resetSessionStore(): void {
  sessions.clear();
}
