import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocketType } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { createSession, endSession, resetSessionStore, selectSquare } from '../src/sessionStore.js';
import { PointSystemType } from '../src/types.js';
import { registerSocketHandlers } from '../src/ws/handlers.js';
import { createIoServer, MAX_SOCKET_MESSAGE_BYTES } from '../src/ws/ioServer.js';
import { WsEvent, type ClientToServerEvents, type ServerToClientEvents } from '../src/ws/events.js';

type ClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

const testConfig: Config = { port: 0, corsOrigins: ['http://localhost:5173'], nodeEnv: 'test' };

let httpServer: HttpServer;
let baseUrl: string;
const openClients: ClientSocket[] = [];

beforeEach(async () => {
  resetSessionStore();
  httpServer = createServer();
  const io = createIoServer(httpServer, testConfig);
  registerSocketHandlers(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;
});

afterEach(async () => {
  for (const client of openClients.splice(0)) {
    client.close();
  }
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connectClient(sessionId: string | undefined): ClientSocket {
  // io() itself isn't generic in this socket.io-client version — the typed
  // Socket<ServerToClientEvents, ClientToServerEvents> alias still checks
  // every .on()/.emit() call site below, this cast just names its type.
  const client = ioClient(baseUrl, {
    query: sessionId === undefined ? {} : { sessionId },
    reconnection: false,
    forceNew: true,
  }) as ClientSocket;
  openClients.push(client);
  return client;
}

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: keyof ServerToClientEvents | 'disconnect',
): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (...args: unknown[]) => void));
}

describe('connection', () => {
  it('rejects an unknown session with an error and disconnects, without sending session-info', async () => {
    const client = connectClient('this-session-id-does-not-exist');
    const errorPromise = waitForEvent<{ error: string; message: string }>(client, WsEvent.Error);
    const disconnectPromise = waitForEvent(client, 'disconnect');

    const errorPayload = await errorPromise;
    expect(errorPayload.error).toBe('UNKNOWN_SESSION');

    await disconnectPromise;
  });

  it('admits a valid in-progress session and sends session-info with ended: false', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);

    const info = await waitForEvent<{ sessionId: string; ended: boolean }>(
      client,
      WsEvent.SessionInfo,
    );
    expect(info.sessionId).toBe(session.id);
    expect(info.ended).toBe(false);
  });

  it('admits an already-ended session and sends session-info with ended: true', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    endSession(session.id, session.adminToken);
    const client = connectClient(session.id);

    const info = await waitForEvent<{ ended: boolean }>(client, WsEvent.SessionInfo);
    expect(info.ended).toBe(true);
  });
});

describe('connection activity', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resets the session clock when a socket connects, so an open tab keeps it alive', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    // Only Date is faked: the socket server and client need their real
    // setTimeout/setInterval to complete a connection at all.
    const connectedAt = session.lastActivityAt.getTime() + 10 * 60 * 1000;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(connectedAt);

    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    expect(session.lastActivityAt.getTime()).toBe(connectedAt);
  });
});

describe('join', () => {
  it('acks with the stored (post-dedup) participantId and name', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const joinedPromise = waitForEvent<{ participantId: string; name: string }>(
      client,
      WsEvent.Joined,
    );
    client.emit(WsEvent.Join, 'mary');
    const joined = await joinedPromise;

    expect(joined.name).toBe('Mary');
    expect(joined.participantId).not.toBe(session.adminParticipantId);
  });

  it('dedupes a second "Jim" to "Jim-1"', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const joinedPromise = waitForEvent<{ name: string }>(client, WsEvent.Joined);
    client.emit(WsEvent.Join, 'Jim');
    const joined = await joinedPromise;

    expect(joined.name).toBe('Jim-1');
  });

  it('rejects a join on an already-ended session with error SESSION_ENDED', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    endSession(session.id, session.adminToken);
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.Join, 'Mary');
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('SESSION_ENDED');
  });
});

describe('admin-auth', () => {
  it('acks with the admin participantId, name, and current selection (null if none)', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const ackPromise = waitForEvent<{ participantId: string; name: string; selection: unknown }>(
      client,
      WsEvent.AdminAcknowledged,
    );
    client.emit(WsEvent.AdminAuth, session.adminToken);
    const ack = await ackPromise;

    expect(ack.participantId).toBe(session.adminParticipantId);
    expect(ack.name).toBe('Jim');
    expect(ack.selection).toBeNull();
  });

  it('includes the admin current selection when one already exists', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    selectSquare(session.id, session.adminParticipantId, 3, 2);
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const ackPromise = waitForEvent<{ selection: { time: number; resource: number } }>(
      client,
      WsEvent.AdminAcknowledged,
    );
    client.emit(WsEvent.AdminAuth, session.adminToken);
    const ack = await ackPromise;

    expect(ack.selection).toEqual({ time: 3, resource: 2 });
  });

  it('rejects a wrong admin token with error INVALID_ADMIN_TOKEN', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.AdminAuth, 'forged-token');
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_ADMIN_TOKEN');
  });
});

describe('select-square', () => {
  async function joinedClient(sessionId: string, name: string): Promise<ClientSocket> {
    const client = connectClient(sessionId);
    await waitForEvent(client, WsEvent.SessionInfo);
    const joinedPromise = waitForEvent(client, WsEvent.Joined);
    client.emit(WsEvent.Join, name);
    await joinedPromise;
    return client;
  }

  it('selects a square and acks with the chosen coordinates', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await joinedClient(session.id, 'Mary');

    const ackPromise = waitForEvent<{ time: number; resource: number }>(
      client,
      WsEvent.SelectionAcknowledged,
    );
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    const ack = await ackPromise;

    expect(ack).toEqual({ time: 3, resource: 2 });
  });

  it('deselects when the same square is selected again', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await joinedClient(session.id, 'Mary');
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    await waitForEvent(client, WsEvent.SelectionAcknowledged);

    const ackPromise = waitForEvent<{ time: number; resource: number }>(
      client,
      WsEvent.SelectionAcknowledged,
    );
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    await ackPromise;

    const participant = Array.from(session.participants.values()).find((p) => p.name === 'Mary')!;
    expect(participant.selection).toBeNull();
  });

  it('rejects a resource coordinate out of range with error INVALID_SELECTION', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await joinedClient(session.id, 'Mary');

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 999 });
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_SELECTION');
  });

  it('rejects a time coordinate out of range with error INVALID_SELECTION', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await joinedClient(session.id, 'Mary');

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.SelectSquare, { time: -1, resource: 2 });
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_SELECTION');
  });

  it('rejects select-square sent before identity is resolved with a generic error', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const errorPromise = waitForEvent<{ error?: string; message: string }>(client, WsEvent.Error);
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBeUndefined();
    expect(errorPayload.message).toBeTruthy();
  });

  it('rejects select-square on an already-ended session with error SESSION_ENDED', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await joinedClient(session.id, 'Mary');
    endSession(session.id, session.adminToken);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('SESSION_ENDED');
  });
});

// selection-changed goes to every tab of the one participant who voted, and to
// nobody else. (selection-acknowledged still fires too — covered above.)
describe('selection-changed', () => {
  async function adminClient(sessionId: string, adminToken: string): Promise<ClientSocket> {
    const client = connectClient(sessionId);
    await waitForEvent(client, WsEvent.SessionInfo);
    const ackPromise = waitForEvent(client, WsEvent.AdminAcknowledged);
    client.emit(WsEvent.AdminAuth, adminToken);
    await ackPromise;
    return client;
  }

  async function participantClient(sessionId: string, name: string): Promise<ClientSocket> {
    const client = connectClient(sessionId);
    await waitForEvent(client, WsEvent.SessionInfo);
    const joinedPromise = waitForEvent(client, WsEvent.Joined);
    client.emit(WsEvent.Join, name);
    await joinedPromise;
    return client;
  }

  // Records whether the event ever arrives, for asserting silence after a wait.
  function watchForSelectionChanged(client: ClientSocket): { received: boolean } {
    const watcher = { received: false };
    client.on(WsEvent.SelectionChanged, () => {
      watcher.received = true;
    });
    return watcher;
  }

  it('sends the new selection to both admin tabs when one of them votes', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const tabOne = await adminClient(session.id, session.adminToken);
    const tabTwo = await adminClient(session.id, session.adminToken);

    const tabOnePromise = waitForEvent(tabOne, WsEvent.SelectionChanged);
    const tabTwoPromise = waitForEvent(tabTwo, WsEvent.SelectionChanged);
    tabOne.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });

    const [tabOneSelection, tabTwoSelection] = await Promise.all([tabOnePromise, tabTwoPromise]);
    expect(tabOneSelection).toEqual({ time: 3, resource: 2 });
    expect(tabTwoSelection).toEqual({ time: 3, resource: 2 });
  });

  it('sends null to both admin tabs when a vote is cleared', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const tabOne = await adminClient(session.id, session.adminToken);
    const tabTwo = await adminClient(session.id, session.adminToken);
    tabOne.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    await waitForEvent(tabTwo, WsEvent.SelectionChanged);

    const tabOnePromise = waitForEvent(tabOne, WsEvent.SelectionChanged);
    const tabTwoPromise = waitForEvent(tabTwo, WsEvent.SelectionChanged);
    tabTwo.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });

    const [tabOneSelection, tabTwoSelection] = await Promise.all([tabOnePromise, tabTwoPromise]);
    expect(tabOneSelection).toBeNull();
    expect(tabTwoSelection).toBeNull();
  });

  it('never tells another participant in the same session about the vote', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const admin = await adminClient(session.id, session.adminToken);
    const mary = await participantClient(session.id, 'Mary');
    const maryWatcher = watchForSelectionChanged(mary);

    const adminPromise = waitForEvent(admin, WsEvent.SelectionChanged);
    admin.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    await adminPromise;
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(maryWatcher.received).toBe(false);
  });

  it('never reaches a same-named participant in a different session', async () => {
    const sessionA = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const sessionB = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const maryInA = await participantClient(sessionA.id, 'Mary');
    const maryInB = await participantClient(sessionB.id, 'Mary');
    const adminInB = await adminClient(sessionB.id, sessionB.adminToken);
    const maryInBWatcher = watchForSelectionChanged(maryInB);
    const adminInBWatcher = watchForSelectionChanged(adminInB);

    const maryInAPromise = waitForEvent(maryInA, WsEvent.SelectionChanged);
    maryInA.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    expect(await maryInAPromise).toEqual({ time: 3, resource: 2 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(maryInBWatcher.received).toBe(false);
    expect(adminInBWatcher.received).toBe(false);
  });
});

// A client can send any payload, whatever the types say. A bad one should get
// INVALID_REQUEST and leave the session unchanged.
describe('malformed payloads', () => {
  // Sends a payload without type checks, so tests can send invalid data.
  function emitRaw(client: ClientSocket, event: string, payload: unknown): void {
    (client as unknown as { emit: (event: string, payload: unknown) => void }).emit(event, payload);
  }

  async function connectedClient(sessionId: string): Promise<ClientSocket> {
    const client = connectClient(sessionId);
    await waitForEvent(client, WsEvent.SessionInfo);
    return client;
  }

  it('rejects a join whose name is not a string with INVALID_REQUEST, adding no participant', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    emitRaw(client, WsEvent.Join, { name: 'Mary' });
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_REQUEST');
    expect(session.participants.size).toBe(1);
  });

  it('rejects an admin-auth whose token is not a string with INVALID_REQUEST, leaving the socket unidentified', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    emitRaw(client, WsEvent.AdminAuth, 42);
    const errorPayload = await errorPromise;
    expect(errorPayload.error).toBe('INVALID_REQUEST');

    // The socket still isn't identified, so voting gets the "no participant" error.
    const voteErrorPromise = waitForEvent<{ error?: string }>(client, WsEvent.Error);
    client.emit(WsEvent.SelectSquare, { time: 3, resource: 2 });
    const voteError = await voteErrorPromise;
    expect(voteError.error).toBeUndefined();
  });

  it.each([
    ['coordinates as strings', { time: '3', resource: '2' }],
    ['a missing coordinate', { time: 3 }],
    ['an extra key', { time: 3, resource: 2, participantId: 'someone-else' }],
    ['no object at all', 'square'],
  ])(
    'rejects a select-square with %s as INVALID_REQUEST, recording no vote',
    async (_case, payload) => {
      const session = createSession({
        adminName: 'Jim',
        pointSystemType: PointSystemType.Numerical,
        sliderMax: 5,
      });
      const client = await connectedClient(session.id);
      const ackPromise = waitForEvent(client, WsEvent.AdminAcknowledged);
      client.emit(WsEvent.AdminAuth, session.adminToken);
      await ackPromise;

      const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
      emitRaw(client, WsEvent.SelectSquare, payload);
      const errorPayload = await errorPromise;

      expect(errorPayload.error).toBe('INVALID_REQUEST');
      expect(session.participants.get(session.adminParticipantId)!.selection).toBeNull();
    },
  );

  it('rejects an end-session whose token is not a string with INVALID_REQUEST, leaving the session open', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    emitRaw(client, WsEvent.EndSession, [session.adminToken]);
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_REQUEST');
    expect(session.ended).toBe(false);
  });

  it('reports which field was wrong in a readable message, not a JSON blob', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);
    const ackPromise = waitForEvent(client, WsEvent.AdminAcknowledged);
    client.emit(WsEvent.AdminAuth, session.adminToken);
    await ackPromise;

    const errorPromise = waitForEvent<{ message: string }>(client, WsEvent.Error);
    emitRaw(client, WsEvent.SelectSquare, { time: 3, resource: '2' });
    const errorPayload = await errorPromise;

    expect(errorPayload.message).toBe('resource: Invalid input: expected number, received string');
  });
});

describe('message size limit', () => {
  it('disconnects a client that sends a message over the size limit', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const disconnectPromise = waitForEvent(client, 'disconnect');
    client.emit(WsEvent.Join, 'x'.repeat(MAX_SOCKET_MESSAGE_BYTES + 1));
    await disconnectPromise;

    expect(session.participants.size).toBe(1);
  });

  // The limit counts the whole packet, not just the name, so stay a bit under it.
  it('still handles a message just under the size limit, answering rather than disconnecting', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.Join, 'x'.repeat(MAX_SOCKET_MESSAGE_BYTES - 100));
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_NAME');
    expect(client.connected).toBe(true);
  });
});

describe('end-session', () => {
  it('broadcasts session-ended to every socket in the session, not just the caller', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const adminClient = connectClient(session.id);
    await waitForEvent(adminClient, WsEvent.SessionInfo);
    const participantClient = connectClient(session.id);
    await waitForEvent(participantClient, WsEvent.SessionInfo);

    const adminEndedPromise = waitForEvent<{ squares: unknown[]; abstained: string[] }>(
      adminClient,
      WsEvent.SessionEnded,
    );
    const participantEndedPromise = waitForEvent<{ squares: unknown[]; abstained: string[] }>(
      participantClient,
      WsEvent.SessionEnded,
    );
    adminClient.emit(WsEvent.EndSession, session.adminToken);

    const [adminReveal, participantReveal] = await Promise.all([
      adminEndedPromise,
      participantEndedPromise,
    ]);
    expect(adminReveal.abstained).toEqual(['Jim']);
    expect(participantReveal.abstained).toEqual(['Jim']);
  });

  it('does not re-broadcast on a second end-session call', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);
    client.emit(WsEvent.EndSession, session.adminToken);
    await waitForEvent(client, WsEvent.SessionEnded);

    let secondBroadcastReceived = false;
    client.once(WsEvent.SessionEnded, () => {
      secondBroadcastReceived = true;
    });
    client.emit(WsEvent.EndSession, session.adminToken);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(secondBroadcastReceived).toBe(false);
  });

  it('rejects a wrong admin token with error INVALID_ADMIN_TOKEN and leaves the session active', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = connectClient(session.id);
    await waitForEvent(client, WsEvent.SessionInfo);

    const errorPromise = waitForEvent<{ error: string }>(client, WsEvent.Error);
    client.emit(WsEvent.EndSession, 'forged-token');
    const errorPayload = await errorPromise;

    expect(errorPayload.error).toBe('INVALID_ADMIN_TOKEN');
    expect(session.ended).toBe(false);
  });
});
