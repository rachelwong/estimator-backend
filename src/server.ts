import http from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createShutdown } from './shutdown.js';
import { registerSocketHandlers } from './ws/handlers.js';
import { createIoServer } from './ws/ioServer.js';
import { startSessionSweeper } from './ws/sessionSweeper.js';

// Render sends SIGTERM on deploy. SIGINT is Ctrl-C.
const SHUTDOWN_SIGNALS = ['SIGTERM', 'SIGINT'] as const;

const config = loadConfig();
const app = createApp(config);
const httpServer = http.createServer(app);

const io = createIoServer(httpServer, config);
registerSocketHandlers(io);
const stopSessionSweeper = startSessionSweeper(io);

const shutdown = createShutdown(io, stopSessionSweeper);
for (const signal of SHUTDOWN_SIGNALS) {
  process.on(signal, () => shutdown(signal));
}

// Log a short message if the server can't start (e.g. port already in use).
httpServer.on('error', (error) => {
  console.error(`Could not start the HTTP server: ${error.message}`);
  process.exit(1);
});

httpServer.listen(config.port, () => {
  console.log(`Jira poker backend listening on port ${config.port}`);
});
