import type http from 'node:http';
import { Server, type DefaultEventsMap } from 'socket.io';
import type { Config } from '../config.js';
import type { ClientToServerEvents, ServerToClientEvents, SocketData } from './events.js';

// Max size of one socket message. Real messages are tiny; the default is 1MB.
// A client that sends more than this is disconnected.
export const MAX_SOCKET_MESSAGE_BYTES = 16 * 1024;

// This only builds the Socket.IO server — it doesn't set up any event
// handling yet (that happens in handlers.ts), the same way app.ts just
// builds the Express app without starting it. It attaches to the existing
// httpServer instead of opening its own, because Render only gives this
// app one network port, so Express and Socket.IO have to share it. The
// type parameters mean TypeScript will catch a typo'd event name, a wrong
// payload, or a wrong socket.data field anywhere this server is used
// later, not just here.
export function createIoServer(
  httpServer: http.Server,
  config: Config,
): Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData> {
  return new Server<ClientToServerEvents, ServerToClientEvents, DefaultEventsMap, SocketData>(
    httpServer,
    { cors: { origin: config.corsOrigins }, maxHttpBufferSize: MAX_SOCKET_MESSAGE_BYTES },
  );
}
