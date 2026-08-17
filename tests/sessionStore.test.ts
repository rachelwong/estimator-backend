import { beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('rejects a non-alphanumeric admin name (an embedded space survives trimming)', () => {
    expectAppError(() => createSession({ adminName: 'Amy Bee', ...NUMERICAL }), 'INVALID_NAME');
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

  it('rejects an embedded space instead of stripping it', () => {
    const session = createSession({ adminName: 'Amy', ...NUMERICAL });

    expectAppError(() => addParticipant(session.id, 'Bea Cee'), 'INVALID_NAME');
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
