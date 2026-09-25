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
import { normalizeParticipantName, validateParticipantName } from './utils/validation.js';

const sessions = new Map<string, SessionState>();

// How long a session outlives the last thing that happened to it. A domain
// rule rather than deployment config, so it lives here and not in config.ts —
// tuning either is a one-line change, with no env override to keep in sync.
export const ENDED_SESSION_TTL_MS = 60 * 60 * 1000;
export const OPEN_SESSION_TTL_MS = 90 * 60 * 1000;
export const SESSION_SWEEP_INTERVAL_MS = 60 * 1000;

// An ended session's clock runs from endedAt, never lastActivityAt, so ending
// a session restarts the countdown instead of inheriting the last vote's.
// Exactly at the TTL is still alive; a millisecond past it isn't.
function isExpired(session: SessionState, now: Date): boolean {
  if (session.ended && session.endedAt) {
    return now.getTime() - session.endedAt.getTime() > ENDED_SESSION_TTL_MS;
  }
  return now.getTime() - session.lastActivityAt.getTime() > OPEN_SESSION_TTL_MS;
}

// The one lookup every other function in this file goes through: an expired
// session is reported missing from the moment its TTL passes, so nothing is
// ever served past it however far away the next sweep is, and no caller needs
// its own expiry check. An expired session reads exactly like one that never
// existed — never tombstoned, never half-served.
//
// It deliberately does NOT delete the entry on the way past. sweepExpiredSessions
// is the single place a session is removed, and the sweeper disconnects the
// sockets still sitting in a removed session's room; deleting here would take
// the id out of the Map before any sweep saw it, stranding those sockets on a
// session that no longer exists. The entry outlives its TTL by at most one sweep
// interval, which was already true of every session nobody reads.
function findLiveSession(sessionId: string): SessionState | undefined {
  const session = sessions.get(sessionId);
  if (!session || isExpired(session, new Date())) {
    return undefined;
  }
  return session;
}

// Normalizes a raw name's whitespace, validates it, then capitalizes each word
// (first letter upper, rest lower) so every stored name is display-ready.
// Per word, not per name: "jim bob" is "Jim Bob", not "Jim bob".
function formatName(name: string): string {
  const normalized = normalizeParticipantName(name);
  validateParticipantName(normalized);
  return normalized
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
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

// Looks up a session by id, or throws UNKNOWN_SESSION if it doesn't exist
// (or has expired, which amounts to the same thing).
function getSessionOrThrow(sessionId: string): SessionState {
  const session = findLiveSession(sessionId);
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

  // Creating a session is itself activity, so both clocks start together.
  const createdAt = new Date();
  const session: SessionState = {
    id: sessionId,
    adminToken: generateAdminToken(),
    adminParticipantId,
    pointSystem: { type: pointSystemType, sliderMax, axisValues },
    participants,
    ended: false,
    createdAt,
    lastActivityAt: createdAt,
    endedAt: null,
  };

  sessions.set(sessionId, session);
  return session;
}

// Plain lookup for a session by id — returns undefined instead of throwing
// if it doesn't exist (or has expired), leaving the "not found" decision to
// the caller. A read is not activity: looking at a session, over REST or from
// a monitor, never postpones its deletion.
export function getSession(sessionId: string): SessionState | undefined {
  return findLiveSession(sessionId);
}

// Resets an open session's clock because somebody opened it — a socket
// connecting, which is a refresh, a latecomer or a second tab. Deliberately a
// named write rather than a side effect hidden inside getSession, since every
// other lookup here is expected to leave the clock alone. Ignored for an ended
// session, whose clock is endedAt, and for one that's already gone.
export function touchSession(sessionId: string): void {
  const session = findLiveSession(sessionId);
  if (!session || session.ended) {
    return;
  }
  session.lastActivityAt = new Date();
}

// Deletes every session whose TTL has passed and returns their ids, so the
// caller (ws/sessionSweeper.ts) can evict the sockets still sitting in their
// rooms. This is the only place a session is ever removed: lookups above stop
// serving one the instant it expires (which is what makes the deadline exact)
// but leave the entry here, so every removal goes out through the one path that
// also disconnects its sockets.
export function sweepExpiredSessions(now: Date = new Date()): string[] {
  const expiredSessionIds: string[] = [];
  for (const [sessionId, session] of sessions) {
    if (isExpired(session, now)) {
      sessions.delete(sessionId);
      expiredSessionIds.push(sessionId);
    }
  }
  return expiredSessionIds;
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
  // Set only once the join has actually succeeded — a rejected name is not
  // activity and must not postpone the session's deletion.
  session.lastActivityAt = new Date();
  return participant;
}

// Records (or clears) a participant's vote. Rejects if the session has ended
// or the {time, resource} pair isn't a real square on this point system.
// Voting the same square again deselects it; voting a different square
// overwrites the previous choice. Returns the resulting selection (null when
// cleared), so the caller reports the outcome, not the click. Two admin tabs
// share one adminParticipantId, so they still overwrite each other — but the
// WS layer sends this result to every tab of that participant, so neither
// tab is left stale.
export function selectSquare(
  sessionId: string,
  participantId: string,
  time: number,
  resource: number,
): Selection | null {
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
  // As in addParticipant: only a vote that passed every check counts as
  // activity.
  session.lastActivityAt = new Date();
  return participant.selection;
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
