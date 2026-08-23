import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocketType } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import { resetSessionStore } from '../src/sessionStore.js';
import { PointSystemType } from '../src/types.js';
import { WsEvent, type ClientToServerEvents, type ServerToClientEvents } from '../src/ws/events.js';
import { registerSocketHandlers } from '../src/ws/handlers.js';
import { createIoServer } from '../src/ws/ioServer.js';

type ClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

// Proves server.ts's actual composition works: Express (REST) and Socket.IO
// (WS) sharing one real http.Server on one real port, the way Render's
// single-port free tier requires. Nothing else exercises this — app.ts is
// tested via supertest (no real port, in tests/sessions.test.ts) and
// ws/handlers.ts is tested against a bare http.Server with no Express
// mounted (tests/handlers.test.ts). Replaces the old manual
// scripts/manual-ws-client.mjs smoke test with something that actually runs
// on every `npm test`, instead of relying on a human remembering to run it.
const testConfig: Config = { port: 0, corsOrigin: 'http://localhost:5173', nodeEnv: 'test' };

let httpServer: HttpServer;
let baseUrl: string;
let client: ClientSocket | undefined;

beforeEach(async () => {
  resetSessionStore();
  const app = createApp(testConfig);
  httpServer = createServer(app);
  const io = createIoServer(httpServer, testConfig);
  registerSocketHandlers(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const address = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${address.port}`;
});

afterEach(async () => {
  client?.close();
  client = undefined;
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: keyof ServerToClientEvents,
): Promise<T> {
  return new Promise((resolve) => socket.once(event, resolve as (...args: unknown[]) => void));
}

describe('server composition', () => {
  it('serves REST and WS on the same real port: create a session over HTTP, then vote and end it over the socket', async () => {
    const createResponse = await fetch(`${baseUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminName: 'Jim',
        pointSystemType: PointSystemType.Numerical,
        sliderMax: 5,
      }),
    });
    expect(createResponse.status).toBe(201);
    const session = (await createResponse.json()) as { sessionId: string; adminToken: string };

    client = ioClient(baseUrl, {
      query: { sessionId: session.sessionId },
      reconnection: false,
    });
    await waitForEvent(client, WsEvent.SessionInfo);

    const adminAckPromise = waitForEvent<{ participantId: string }>(
      client,
      WsEvent.AdminAcknowledged,
    );
    client.emit(WsEvent.AdminAuth, session.adminToken);
    await adminAckPromise;

    const selectionAckPromise = waitForEvent(client, WsEvent.SelectionAcknowledged);
    client.emit(WsEvent.SelectSquare, { time: 2, resource: 3 });
    await selectionAckPromise;

    const endedPromise = waitForEvent<{
      squares: { time: number; resource: number; names: string[] }[];
    }>(client, WsEvent.SessionEnded);
    client.emit(WsEvent.EndSession, session.adminToken);
    const reveal = await endedPromise;
    expect(reveal.squares).toEqual([{ time: 2, resource: 3, names: ['Jim'] }]);

    const getResponse = await fetch(`${baseUrl}/sessions/${session.sessionId}`);
    const getBody = (await getResponse.json()) as { ended: boolean };
    expect(getBody.ended).toBe(true);
  });
});
