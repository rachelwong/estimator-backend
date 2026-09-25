import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocketType } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { createSession, getSession, resetSessionStore } from '../src/sessionStore.js';
import { PointSystemType } from '../src/types.js';
import {
  WsEvent,
  type AppServer,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '../src/ws/events.js';
import { registerSocketHandlers } from '../src/ws/handlers.js';
import { createIoServer } from '../src/ws/ioServer.js';
import { startSessionSweeper } from '../src/ws/sessionSweeper.js';

type ClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

// The wiring test for the sweeper: sessionStore.test.ts already proves which
// sessions expire, so what's left unproven is that the timer actually runs
// against a real Socket.IO server and evicts the sockets still sitting in a
// deleted session's room. server.ts itself stays untested, so this is the
// closest thing to it.
const testConfig: Config = { port: 0, corsOrigins: ['http://localhost:5173'], nodeEnv: 'test' };

const OPEN_TTL_MS = 90 * 60 * 1000;

let httpServer: HttpServer;
let baseUrl: string;
let io: AppServer;
let stopSweeper: () => void;
const openClients: ClientSocket[] = [];

beforeEach(async () => {
  resetSessionStore();
  // Date so sessions can be aged, setInterval/clearInterval so the sweeper's
  // own timer is under the test's control — but not setTimeout, which
  // Socket.IO's connection handshake and this file's waits both depend on.
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });

  httpServer = createServer();
  io = createIoServer(httpServer, testConfig);
  registerSocketHandlers(io);
  stopSweeper = startSessionSweeper(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;
});

afterEach(async () => {
  stopSweeper();
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const client of openClients.splice(0)) {
    client.close();
  }
  // Use io.close(), not httpServer.close(). httpServer.close() waits for open
  // connections to finish, and here it sometimes hung until the 10s timeout.
  await io.close();
});

async function connectedClient(sessionId: string): Promise<ClientSocket> {
  const client = ioClient(baseUrl, {
    query: { sessionId },
    reconnection: false,
    forceNew: true,
  }) as ClientSocket;
  openClients.push(client);
  await new Promise<void>((resolve) => client.once(WsEvent.SessionInfo, () => resolve()));
  return client;
}

describe('startSessionSweeper', () => {
  it('deletes an expired session and disconnects the sockets still in it', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);
    const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));

    vi.advanceTimersByTime(OPEN_TTL_MS + 60 * 1000);
    await disconnected;

    expect(getSession(session.id)).toBeUndefined();
    expect(client.connected).toBe(false);
  });

  // The end-to-end version of the store's "leaves an expired session in place"
  // guard: a REST read or a second tab connecting is enough to look an expired
  // session up, and if that lookup removed it, the tab below would sit there
  // connected to nothing until its next click.
  it('disconnects sockets from a session a read has already reported missing', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);
    const disconnected = new Promise<void>((resolve) => client.once('disconnect', () => resolve()));

    // Age past the TTL without firing the sweep, then read it.
    vi.setSystemTime(Date.now() + OPEN_TTL_MS + 1);
    expect(getSession(session.id)).toBeUndefined();

    vi.advanceTimersByTime(60 * 1000);
    await disconnected;

    expect(client.connected).toBe(false);
  });

  it('logs and keeps sweeping when a sweep throws, instead of taking the process down', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Only the first sweep that has something to evict fails; an uncaught
    // throw here would surface as an unhandled error and fail this file.
    const roomFor = vi.spyOn(io, 'in').mockImplementationOnce(() => {
      throw new Error('adapter unavailable');
    });
    createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });

    vi.advanceTimersByTime(OPEN_TTL_MS + 60 * 1000);
    expect(consoleError).toHaveBeenCalled();

    // The timer survived: a session that expires later is still swept.
    createSession({
      adminName: 'Mary',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    vi.advanceTimersByTime(OPEN_TTL_MS + 60 * 1000);

    expect(roomFor).toHaveBeenCalledTimes(2);
  });

  it('leaves a live session and its sockets alone', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const client = await connectedClient(session.id);

    vi.advanceTimersByTime(5 * 60 * 1000);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(getSession(session.id)).toBe(session);
    expect(client.connected).toBe(true);
  });
});
