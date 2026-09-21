import cors from 'cors';
import express, { type Express } from 'express';
import type { Config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionsRouter } from './routes/sessions.js';

export function createApp(config: Config): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());

  // Basic health check so uptime monitors can confirm the server is running.
  // The log line is the service's heartbeat: nothing else here logs a
  // successful request, so without it the log stream stays silent until
  // something errors, and the keep-alive ping is invisible. At one ping per 10
  // minutes that's cheap, and it's what makes a lost session diagnosable — a
  // gap in the heartbeat followed by server.ts's "listening on port" line is a
  // restart (deploy or spin-down) that wiped the in-memory session store.
  app.get('/healthz', (_req, res) => {
    console.log('GET /healthz');
    res.status(200).json({ status: 'ok' });
  });

  // All session-related endpoints (create session, get session, etc.) live under /sessions.
  app.use('/sessions', sessionsRouter);

  app.use(errorHandler);

  return app;
}
