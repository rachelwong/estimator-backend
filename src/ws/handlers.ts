import { ZodError } from 'zod';
import { AppError, ErrorCode } from '../errors.js';
import type { SessionState } from '../types.js';
import {
  addParticipant,
  endSession,
  getSession,
  selectSquare,
  touchSession,
  validateAdminToken,
} from '../sessionStore.js';
import { formatZodError } from '../utils/validation.js';
import { WsEvent, type AppServer, type AppSocket } from './events.js';
import {
  AdminAuthPayloadSchema,
  EndSessionPayloadSchema,
  JoinPayloadSchema,
  SelectSquarePayloadSchema,
} from './schemas.js';

function readSessionId(socket: AppSocket): string | undefined {
  const { sessionId } = socket.handshake.query;
  return typeof sessionId === 'string' ? sessionId : undefined;
}

// Translates a thrown AppError into the shared { error: code, message } WS
// error shape and logs it — the same two-tier treatment
// middleware/errorHandler.ts gives the REST transport: console.warn for an
// expected AppError or a bad payload (ZodError, sent as INVALID_REQUEST),
// console.error (with the full value) only for a true-
// unexpected bug, so a real WS bug is as visible in the logs as its REST
// equivalent would be, instead of being silently swallowed.
// The room holding every socket of one participant, so a selection reaches all
// their tabs and nobody else. Prefixed with the session id because rooms share
// one namespace with the per-session rooms, and participant ids are only
// unique within a session.
function participantRoom(sessionId: string, participantId: string): string {
  return `${sessionId}:${participantId}`;
}

function withErrorHandling(socket: AppSocket, fn: () => void): void {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) {
      console.warn(`[${error.code}] ${error.message}`);
      socket.emit(WsEvent.Error, { error: error.code, message: error.message });
      return;
    }
    if (error instanceof ZodError) {
      const message = formatZodError(error);
      console.warn(`[${ErrorCode.InvalidRequest}] ${message}`);
      socket.emit(WsEvent.Error, { error: ErrorCode.InvalidRequest, message });
      return;
    }
    console.error(`[${ErrorCode.InternalError}]`, error);
    socket.emit(WsEvent.Error, {
      error: ErrorCode.InternalError,
      message: 'An unexpected error occurred',
    });
  }
}

// A participant joining the session by name. Adds them as a new
// participant (deduped, display-ready name) and remembers their id on
// socket.data, so later events from this same socket — like a vote — know
// who they belong to. Acks the client with the name they actually got
// assigned, in case it got suffixed (e.g. a second "Jim" becomes "Jim-1").
function handleJoin(socket: AppSocket, session: SessionState, payload: unknown): void {
  withErrorHandling(socket, () => {
    const name = JoinPayloadSchema.parse(payload);
    const participant = addParticipant(session.id, name);
    socket.data.participantId = participant.id;
    void socket.join(participantRoom(session.id, participant.id));
    socket.emit(WsEvent.Joined, { participantId: participant.id, name: participant.name });
  });
}

// The admin proving who they are with the token they got back when they
// created the session. On success this socket is now treated as the admin
// for the rest of the connection, the same way a normal join is. The ack
// includes the admin's current selection (not just their id/name), so a
// second admin tab, or just refreshing, shows the real vote instead of a
// blank grid.
function handleAdminAuth(socket: AppSocket, session: SessionState, payload: unknown): void {
  withErrorHandling(socket, () => {
    const adminToken = AdminAuthPayloadSchema.parse(payload);
    const validatedSession = validateAdminToken(session.id, adminToken);
    const adminParticipant = validatedSession.participants.get(
      validatedSession.adminParticipantId,
    )!;
    socket.data.participantId = adminParticipant.id;
    void socket.join(participantRoom(session.id, adminParticipant.id));
    socket.emit(WsEvent.AdminAcknowledged, {
      participantId: adminParticipant.id,
      name: adminParticipant.name,
      selection: adminParticipant.selection,
    });
  });
}

// A vote. This only works once the socket has already joined or
// authenticated as admin — if participantId isn't set yet, the event can
// only have come from a hand-forged socket call (a real client always
// joins first), so it's rejected with a plain error and no dedicated code.
// Voting the same square again clears the vote instead of recording it
// again. The result goes to every tab of this one participant (never the
// session at large), so a second tab stays in step without learning anyone
// else's vote.
function handleSelectSquare(
  io: AppServer,
  socket: AppSocket,
  session: SessionState,
  payload: unknown,
): void {
  withErrorHandling(socket, () => {
    const { time, resource } = SelectSquarePayloadSchema.parse(payload);
    const { participantId } = socket.data;
    // Only reachable via a hand-forged socket call, never a real client flow —
    // no dedicated ErrorCode (decision #22a).
    if (!participantId) {
      socket.emit(WsEvent.Error, { message: 'No participant identified for this socket yet' });
      return;
    }
    const selection = selectSquare(session.id, participantId, time, resource);
    io.to(participantRoom(session.id, participantId)).emit(WsEvent.SelectionChanged, selection);
    // Old event, kept until both frontends listen for selection-changed.
    socket.emit(WsEvent.SelectionAcknowledged, { time, resource });
  });
}

// The admin ending the session. Re-checks the admin token itself, even if
// this socket already authenticated earlier — there's no "already trusted"
// shortcut. Only pushes the reveal to everyone in the room the first time;
// a repeat call (two tabs, a double-click) is a silent no-op, not an error.
function handleEndSession(
  io: AppServer,
  socket: AppSocket,
  session: SessionState,
  payload: unknown,
): void {
  withErrorHandling(socket, () => {
    const adminToken = EndSessionPayloadSchema.parse(payload);
    const { reveal, wasAlreadyEnded } = endSession(session.id, adminToken);
    if (!wasAlreadyEnded) {
      io.to(session.id).emit(WsEvent.SessionEnded, reveal);
    }
  });
}

// Registers every socket event on the default namespace. Each connected
// socket keeps its own participantId in socket.data (Socket.IO's built-in
// per-connection state slot), set by handleJoin/handleAdminAuth and never
// read from an incoming payload — never trust the client, applied to
// identity. Every payload is also checked against ws/schemas.ts before use.
export function registerSocketHandlers(io: AppServer): void {
  io.on('connection', (socket: AppSocket) => {
    const sessionId = readSessionId(socket);
    const session = sessionId ? getSession(sessionId) : undefined;

    if (!session) {
      socket.emit(WsEvent.Error, {
        error: ErrorCode.UnknownSession,
        message: `No session found with id "${sessionId ?? ''}"`,
      });
      socket.disconnect();
      return;
    }

    void socket.join(session.id);
    // Opening a session counts as activity, not just voting: in a real meeting
    // everyone votes in the first ten minutes and then talks for an hour, so a
    // vote-only clock would delete the session out from under the discussion.
    // A refresh, a latecomer or a second tab all keep it alive.
    touchSession(session.id);
    socket.emit(WsEvent.SessionInfo, {
      sessionId: session.id,
      pointSystem: session.pointSystem,
      ended: session.ended,
    });

    socket.on(WsEvent.Join, (name) => handleJoin(socket, session, name));
    socket.on(WsEvent.AdminAuth, (adminToken) => handleAdminAuth(socket, session, adminToken));
    socket.on(WsEvent.SelectSquare, (payload) => handleSelectSquare(io, socket, session, payload));
    socket.on(WsEvent.EndSession, (adminToken) =>
      handleEndSession(io, socket, session, adminToken),
    );
  });
}
