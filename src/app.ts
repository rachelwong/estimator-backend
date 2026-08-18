import cors from 'cors';
import express, { type Express } from 'express';
import type { Config } from './config.js';
import { errorHandler } from './middleware/errorHandler.js';
import { sessionsRouter } from './routes/sessions.js';

export function createApp(config: Config): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigin }));
  app.use(express.json());

  // Basic health check so uptime monitors can confirm the server is running.
  app.get('/healthz', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // All session-related endpoints (create session, get session, etc.) live under /sessions.
  app.use('/sessions', sessionsRouter);

  app.use(errorHandler);

  return app;
}
