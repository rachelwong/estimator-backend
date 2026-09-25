import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as ioClient, type Socket as ClientSocketType } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../src/config.js';
import { createSession, resetSessionStore } from '../src/sessionStore.js';
import { createShutdown } from '../src/shutdown.js';
import { PointSystemType } from '../src/types.js';
import type { AppServer, ClientToServerEvents, ServerToClientEvents } from '../src/ws/events.js';
import { WsEvent } from '../src/ws/events.js';
import { registerSocketHandlers } from '../src/ws/handlers.js';
import { createIoServer } from '../src/ws/ioServer.js';

type ClientSocket = ClientSocketType<ServerToClientEvents, ClientToServerEvents>;

const testConfig: Config = { port: 0, corsOrigins: ['http://localhost:5173'], nodeEnv: 'test' };

let httpServer: HttpServer;
let io: AppServer;
let baseUrl: string;
let client: ClientSocket | undefined;

beforeEach(async () => {
  resetSessionStore();
  httpServer = createServer();
  io = createIoServer(httpServer, testConfig);
  registerSocketHandlers(io);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterEach(async () => {
  vi.useRealTimers();
  client?.close();
  client = undefined;
  if (httpServer.listening) {
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  }
});

// A fake exit(). `exited` resolves with the first exit code passed to it.
function recordExit(): { exit: (code: number) => void; exited: Promise<number> } {
  let resolveExit!: (code: number) => void;
  const exited = new Promise<number>((resolve) => (resolveExit = resolve));
  return { exit: vi.fn((code: number) => resolveExit(code)), exited };
}

describe('graceful shutdown', () => {
  it('stops the sweeper, disconnects connected clients, closes the http server and exits 0', async () => {
    const session = createSession({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    client = ioClient(baseUrl, {
      query: { sessionId: session.id },
      reconnection: false,
      forceNew: true,
    });
    await new Promise((resolve) => client!.once(WsEvent.SessionInfo, resolve));

    const stopSweeper = vi.fn();
    const { exit, exited } = recordExit();
    const disconnected = new Promise((resolve) => client!.once('disconnect', resolve));

    createShutdown(io, stopSweeper, exit)('SIGTERM');

    await disconnected;
    expect(await exited).toBe(0);
    expect(stopSweeper).toHaveBeenCalledTimes(1);
    expect(httpServer.listening).toBe(false);
  });

  it('ignores a second signal while the first shutdown is still running', async () => {
    const stopSweeper = vi.fn();
    const { exit, exited } = recordExit();
    const shutdown = createShutdown(io, stopSweeper, exit);

    shutdown('SIGTERM');
    shutdown('SIGINT');
    await exited;

    expect(stopSweeper).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledTimes(1);
  });
});

describe('forced exit', () => {
  // A fake io whose close() never finishes.
  const stuckIo = { close: () => new Promise<void>(() => {}) } as unknown as AppServer;

  it('does not force an exit at exactly the deadline', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    createShutdown(stuckIo, () => {}, exit, 10_000)('SIGTERM');

    vi.advanceTimersByTime(9_999);

    expect(exit).not.toHaveBeenCalled();
  });

  it('exits 1 once the deadline passes without the close finishing', () => {
    vi.useFakeTimers();
    const exit = vi.fn();
    createShutdown(stuckIo, () => {}, exit, 10_000)('SIGTERM');

    vi.advanceTimersByTime(10_000);

    expect(exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
