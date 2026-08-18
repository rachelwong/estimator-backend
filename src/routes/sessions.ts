import { Router } from 'express';
import { AppError, ErrorCode } from '../errors.js';
import { CreateSessionRequestSchema } from '../schemas.js';
import { computeReveal, createSession, getSession } from '../sessionStore.js';

export const sessionsRouter: Router = Router();

// Creates a new estimation session and makes the requester its admin.
sessionsRouter.post('/', (req, res) => {
  const body = CreateSessionRequestSchema.parse(req.body);
  const session = createSession(body);
  const adminParticipant = session.participants.get(session.adminParticipantId)!;

  res.status(201).json({
    sessionId: session.id,
    adminToken: session.adminToken,
    adminParticipantId: session.adminParticipantId,
    adminName: adminParticipant.name,
    pointSystem: session.pointSystem,
  });
});

// Fetches a session's current state; if the session has ended, also includes the revealed estimates.
sessionsRouter.get('/:id', (req, res) => {
  const session = getSession(req.params.id);
  if (!session) {
    throw new AppError(ErrorCode.UnknownSession, `No session found with id "${req.params.id}"`);
  }

  res.status(200).json({
    sessionId: session.id,
    pointSystem: session.pointSystem,
    ended: session.ended,
    ...(session.ended ? { reveal: computeReveal(session) } : {}),
  });
});
