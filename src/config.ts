const PRODUCTION_NODE_ENV = 'production';

// Must match .env.example's CORS_ORIGIN default — tests/config.test.ts asserts this.
export const LOCAL_DEV_CORS_ORIGIN = 'http://localhost:5173';

export interface Config {
  port: number;
  corsOrigin: string;
  nodeEnv: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.PORT ? Number(env.PORT) : 3001;
  const corsOrigin = env.CORS_ORIGIN ?? '';
  const nodeEnv = env.NODE_ENV ?? 'development';

  if (nodeEnv === PRODUCTION_NODE_ENV) {
    if (!corsOrigin) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
    if (corsOrigin.endsWith('/')) {
      throw new Error('CORS_ORIGIN must not have a trailing slash');
    }
    if (corsOrigin === LOCAL_DEV_CORS_ORIGIN) {
      throw new Error('CORS_ORIGIN must not be the local development default in production');
    }
  }

  return { port, corsOrigin, nodeEnv };
}
