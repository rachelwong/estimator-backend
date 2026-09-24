import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { expectAppError } from './helpers.js';

vi.mock('../src/utils/id.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/utils/id.js')>();
  return {
    ...actual,
    generateSessionId: vi.fn(actual.generateSessionId),
  };
});

import { generateSessionId } from '../src/utils/id.js';
import {
  addParticipant,
  computeReveal,
  createSession,
  endSession,
  getSession,
  resetSessionStore,
  selectSquare,
  sweepExpiredSessions,
  touchSession,
  validateAdminToken,
} from '../src/sessionStore.js';

const NUMERICAL = { pointSystemType: 'numerical', sliderMax: 5 } as const;

beforeEach(() => {
  resetSessionStore();
});

describe('createSession', () => {
  it('creates the admin as the sole initial participant', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expect(session.participants.size).toBe(1);
    expect(session.participants.get(session.adminParticipantId)).toEqual({
      id: session.adminParticipantId,
      name: 'Amy',
      selection: null,
      isAdmin: true,
    });
  });

  it('trims leading/trailing whitespace from the admin name', () => {
    const session = createSession({ adminName: '  Amy  ', ...NUMERICAL });

    expect(session.participants.get(session.adminParticipantId)?.name).toBe('Amy');
  });

  it('capitalizes the admin name', () => {
    const session = createSession({ adminName: 'aMY', ...NUMERICAL });

    expect(session.participants.get(session.adminParticipantId)?.name).toBe('Amy');
  });

  it('rejects an empty admin name', () => {
    expectAppError(() => createSession({ adminName: '', ...NUMERICAL }), 'INVALID_NAME');
  });

  it('rejects an admin name over 20 characters', () => {
    expectAppError(
      () => createSession({ adminName: 'a'.repeat(21), ...NUMERICAL }),
      'INVALID_NAME',
    );
  });

  it('rejects an admin name carrying a symbol', () => {
    expectAppError(() => createSession({ adminName: 'Amy@Bee', ...NUMERICAL }), 'INVALID_NAME');
  });

  it('keeps an embedded space and capitalizes each word', () => {
    const session = createSession({ adminName: 'amy bee', ...NUMERICAL });

    expect(session.participants.get(session.adminParticipantId)?.name).toBe('Amy Bee');
  });

  it('regenerates the session id when the generator produces a collision', () => {
    const first = createSession({ adminName: 'Amy', ...NUMERICAL });
    vi.mocked(generateSessionId)
      .mockReturnValueOnce(first.id)
      .mockReturnValueOnce('forced-unique-session-id');

    const second = createSession({ adminName: 'Bea', ...NUMERICAL });

    expect(second.id).toBe('forced-unique-session-id');
    expect(second.id).not.toBe(first.id);
  });
});

describe('getSession', () => {
  it('returns the session when it exists', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expect(getSession(session.id)).toBe(session);
  });

  it('returns undefined when the session does not exist', () => {
    expect(getSession('does-not-exist')).toBeUndefined();
  });
});

describe('addParticipant', () => {
  it('rejects joining a session that does not exist', () => {
    expectAppError(() => addParticipant('does-not-exist', 'Bea'), 'UNKNOWN_SESSION');
  });

  it('accepts a name at the 20-character ceiling', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    const participant = addParticipant(session.id, 'abcdefghijklmnopqrst');

    expect(participant.name).toBe('Abcdefghijklmnopqrst');
  });

  it('trims leading/trailing whitespace before storing the name', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    const participant = addParticipant(session.id, '  Bea  ');

    expect(participant.name).toBe('Bea');
  });

  it('rejects a name carrying a symbol', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(() => addParticipant(session.id, 'Bea@Cee'), 'INVALID_NAME');
  });

  it('keeps an embedded space and collapses a doubled one', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    const participant = addParticipant(session.id, 'bea  cee');

    expect(participant.name).toBe('Bea Cee');
  });

  it('capitalizes a valid name', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    const participant = addParticipant(session.id, 'bEA');

    expect(participant.name).toBe('Bea');
  });

  it('rejects an empty name', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(() => addParticipant(session.id, ''), 'INVALID_NAME');
  });

  it('rejects a name over 20 characters', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(() => addParticipant(session.id, 'b'.repeat(21)), 'INVALID_NAME');
  });

  it('de-dupes repeated names via an existence-check loop, not a naive count of "Jim*" matches', () => {
    const session = createSession({ adminName: 'Jim', ...NUMERICAL });

    const second = addParticipant(session.id, 'Jim');
    const third = addParticipant(session.id, 'Jim');

    expect(second.name).toBe('Jim-1');
    expect(third.name).toBe('Jim-2');
  });

  it('de-dupes case-insensitively against an existing participant', () => {
    const session = createSession({ adminName: 'Jim', ...NUMERICAL });

    const participant = addParticipant(session.id, 'jim');

    expect(participant.name).toBe('Jim-1');
  });

  it('rejects joining a session that has already ended', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    endSession(session.id, session.adminToken);

    expectAppError(() => addParticipant(session.id, 'Bea'), 'SESSION_ENDED');
  });
});

describe('selectSquare', () => {
  it('rejects voting in a session that does not exist', () => {
    expectAppError(
      () => selectSquare('does-not-exist', 'some-participant-id', 2, 3),
      'UNKNOWN_SESSION',
    );
  });

  it('rejects a selection when only one coordinate is out of range', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    // resource (3) is a valid axis value on its own — only time (100) is out
    // of range, so this only fails if both coordinates are checked independently.
    expectAppError(
      () => selectSquare(session.id, session.adminParticipantId, 100, 3),
      'INVALID_SELECTION',
    );
  });

  it('records a first vote', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    selectSquare(session.id, session.adminParticipantId, 2, 3);

    expect(session.participants.get(session.adminParticipantId)?.selection).toEqual({
      time: 2,
      resource: 3,
    });
  });

  it('deselects when voting the exact same square again', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    selectSquare(session.id, session.adminParticipantId, 2, 3);

    selectSquare(session.id, session.adminParticipantId, 2, 3);

    expect(session.participants.get(session.adminParticipantId)?.selection).toBeNull();
  });

  it('overwrites the previous selection when voting a different square', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    selectSquare(session.id, session.adminParticipantId, 2, 3);

    selectSquare(session.id, session.adminParticipantId, 4, 1);

    expect(session.participants.get(session.adminParticipantId)?.selection).toEqual({
      time: 4,
      resource: 1,
    });
  });

  it('rejects a {time, resource} pair that is not an exact member of the axis values', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(
      () => selectSquare(session.id, session.adminParticipantId, 100, 100),
      'INVALID_SELECTION',
    );
  });

  it('rejects a vote once the session has ended', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    endSession(session.id, session.adminToken);

    expectAppError(
      () => selectSquare(session.id, session.adminParticipantId, 2, 3),
      'SESSION_ENDED',
    );
  });
});

describe('endSession', () => {
  it('marks the session ended and returns the reveal', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    selectSquare(session.id, session.adminParticipantId, 2, 3);

    const { reveal, wasAlreadyEnded } = endSession(session.id, session.adminToken);

    expect(wasAlreadyEnded).toBe(false);
    expect(reveal).toEqual({
      squares: [{ time: 2, resource: 3, names: ['Amy'] }],
      abstained: [],
    });
  });

  it('is idempotent: a second call reports wasAlreadyEnded and an identical reveal', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    selectSquare(session.id, session.adminParticipantId, 2, 3);
    const firstCall = endSession(session.id, session.adminToken);

    const secondCall = endSession(session.id, session.adminToken);

    expect(secondCall.wasAlreadyEnded).toBe(true);
    expect(secondCall.reveal).toEqual(firstCall.reveal);
  });

  it('rejects a bad token even on an already-ended session', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    endSession(session.id, session.adminToken);

    expectAppError(() => endSession(session.id, 'wrong-token'), 'INVALID_ADMIN_TOKEN');
  });
});

describe('validateAdminToken', () => {
  it('rejects an unknown session id before ever checking the token', () => {
    expectAppError(() => validateAdminToken('does-not-exist', 'any-token'), 'UNKNOWN_SESSION');
  });

  it('rejects a mismatched token for a known session', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(() => validateAdminToken(session.id, 'wrong-token'), 'INVALID_ADMIN_TOKEN');
  });

  it('returns the session on a matching token', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expect(validateAdminToken(session.id, session.adminToken)).toBe(session);
  });
});

describe('session TTL', () => {
  // Hand-typed from the rule ("ended: 1 hour; open: 1.5 hours after the last
  // activity"), deliberately not imported from sessionStore.ts — an expected
  // timing taken from the same constant the implementation uses can't disagree
  // with it.
  const MINUTE_MS = 60 * 1000;
  const ENDED_TTL_MS = 60 * MINUTE_MS;
  const OPEN_TTL_MS = 90 * MINUTE_MS;
  const START = new Date('2026-09-24T09:00:00.000Z');

  // Moves the clock to a fixed offset from the session's creation, so every
  // step of a test is stated as an absolute age rather than a delta on the
  // previous one.
  function atAge(offsetMs: number): void {
    vi.setSystemTime(new Date(START.getTime() + offsetMs));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('an ended session', () => {
    it('survives to exactly 1 hour after it ended and is gone 1 ms later', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });
      endSession(session.id, session.adminToken);

      atAge(ENDED_TTL_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(ENDED_TTL_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('reads as unknown, not ended, once its TTL has passed', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });
      endSession(session.id, session.adminToken);

      atAge(ENDED_TTL_MS + 1);

      expectAppError(() => addParticipant(session.id, 'Bea'), 'UNKNOWN_SESSION');
      expectAppError(
        () => selectSquare(session.id, session.adminParticipantId, 2, 3),
        'UNKNOWN_SESSION',
      );
    });

    it('runs its clock from endedAt, not from the last activity before it', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });
      // Voting at 45 min and ending at 50 min puts the two candidate deadlines
      // far apart: from endedAt it expires at 1 h 50 min, from lastActivityAt
      // it would be 2 h 15 min. Ending at a round offset would make both land
      // on the same instant and prove nothing.
      atAge(45 * MINUTE_MS);
      selectSquare(session.id, session.adminParticipantId, 2, 3);
      atAge(50 * MINUTE_MS);
      endSession(session.id, session.adminToken);

      atAge(110 * MINUTE_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(110 * MINUTE_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('is not kept alive by touchSession — an ended clock cannot be reset', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });
      endSession(session.id, session.adminToken);

      atAge(30 * MINUTE_MS);
      touchSession(session.id);

      atAge(ENDED_TTL_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(ENDED_TTL_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });
  });

  describe('an open session', () => {
    it('survives to exactly 1.5 hours after creation and is gone 1 ms later', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(OPEN_TTL_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(OPEN_TTL_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    // One test per source of activity, so a clock reset that only fires on,
    // say, a vote can't hide behind a join happening in the same test.
    it.each([
      [
        'a join',
        (session: { id: string; adminParticipantId: string }) => {
          addParticipant(session.id, 'Bea');
        },
      ],
      [
        'a vote',
        (session: { id: string; adminParticipantId: string }) => {
          selectSquare(session.id, session.adminParticipantId, 2, 3);
        },
      ],
      [
        'a socket opening it',
        (session: { id: string; adminParticipantId: string }) => {
          touchSession(session.id);
        },
      ],
    ])('has its clock reset by %s', (_activity, act) => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(60 * MINUTE_MS);
      act(session);

      atAge(150 * MINUTE_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(150 * MINUTE_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('is not extended by a rejected action', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(60 * MINUTE_MS);
      expectAppError(
        () => selectSquare(session.id, session.adminParticipantId, 100, 3),
        'INVALID_SELECTION',
      );

      atAge(OPEN_TTL_MS);
      expect(getSession(session.id)).toBe(session);

      atAge(OPEN_TTL_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('is not extended by a pure read', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(60 * MINUTE_MS);
      expect(getSession(session.id)).toBe(session);
      expect(validateAdminToken(session.id, session.adminToken)).toBe(session);

      atAge(OPEN_TTL_MS + 1);
      expect(getSession(session.id)).toBeUndefined();
    });

    it('reads as unknown once its TTL has passed', () => {
      const session = createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(OPEN_TTL_MS + 1);

      expectAppError(() => addParticipant(session.id, 'Bea'), 'UNKNOWN_SESSION');
      expectAppError(() => validateAdminToken(session.id, session.adminToken), 'UNKNOWN_SESSION');
    });
  });

  it('gives each session its own clock', () => {
    const abandoned = createSession({ adminName: 'Amy', ...NUMERICAL });
    const busy = createSession({ adminName: 'Bea', ...NUMERICAL });

    atAge(60 * MINUTE_MS);
    touchSession(busy.id);

    atAge(OPEN_TTL_MS + 1);
    expect(getSession(abandoned.id)).toBeUndefined();
    expect(getSession(busy.id)).toBe(busy);
  });

  it('ignores touchSession for a session that does not exist', () => {
    expect(() => touchSession('does-not-exist')).not.toThrow();
  });

  // A lookup must not remove the entry behind the sweeper's back: the sweep is
  // what disconnects the sockets still sitting in an expired session's room,
  // and it can only do that for ids it finds. A read that deleted the session
  // itself would take it out of the Map before any sweep saw it, leaving those
  // tabs connected to a session that no longer exists.
  it('leaves an expired session in place for the sweep, even after a read reports it missing', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    atAge(OPEN_TTL_MS + 1);
    expect(getSession(session.id)).toBeUndefined();

    expect(sweepExpiredSessions()).toEqual([session.id]);
  });

  describe('sweepExpiredSessions', () => {
    it('deletes exactly the expired sessions and returns their ids', () => {
      const expired = createSession({ adminName: 'Amy', ...NUMERICAL });
      const alive = createSession({ adminName: 'Bea', ...NUMERICAL });

      atAge(60 * MINUTE_MS);
      touchSession(alive.id);

      atAge(OPEN_TTL_MS + 1);
      const sweptIds = sweepExpiredSessions();

      expect(sweptIds).toEqual([expired.id]);
      expect(getSession(alive.id)).toBe(alive);
    });

    it('returns an empty list when nothing has expired', () => {
      createSession({ adminName: 'Amy', ...NUMERICAL });

      atAge(OPEN_TTL_MS);

      expect(sweepExpiredSessions()).toEqual([]);
    });
  });
});

describe('computeReveal', () => {
  it('groups participants by their selected square', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    const bea = addParticipant(session.id, 'Bea');
    const cid = addParticipant(session.id, 'Cid');
    selectSquare(session.id, session.adminParticipantId, 2, 3);
    selectSquare(session.id, bea.id, 2, 3);
    selectSquare(session.id, cid.id, 4, 1);

    expect(computeReveal(session)).toEqual({
      squares: [
        { time: 2, resource: 3, names: ['Amy', 'Bea'] },
        { time: 4, resource: 1, names: ['Cid'] },
      ],
      abstained: [],
    });
  });

  it('lists every non-voter as abstained when nobody has voted', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    addParticipant(session.id, 'Bea');

    expect(computeReveal(session)).toEqual({
      squares: [],
      abstained: ['Amy', 'Bea'],
    });
  });

  it('some participants vote on different squares while another abstains entirely', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });
    const bea = addParticipant(session.id, 'Bea');
    addParticipant(session.id, 'Cid');
    selectSquare(session.id, session.adminParticipantId, 2, 3);
    selectSquare(session.id, bea.id, 4, 1);
    // Cid never votes.

    expect(computeReveal(session)).toEqual({
      squares: [
        { time: 2, resource: 3, names: ['Amy'] },
        { time: 4, resource: 1, names: ['Bea'] },
      ],
      abstained: ['Cid'],
    });
  });
});
