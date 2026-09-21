const PRODUCTION_NODE_ENV = 'production';

// Must match .env.example's CORS_ORIGIN default — tests/config.test.ts asserts this.
export const LOCAL_DEV_CORS_ORIGIN = 'http://localhost:5173';

// CORS_ORIGIN is a comma-separated list, so one backend can serve several
// frontends. `cors` and Socket.IO both take the resulting array and reflect
// back only the entry matching the request's Origin — a raw "a,b" string would
// be echoed verbatim into Access-Control-Allow-Origin, which browsers reject.
const CORS_ORIGIN_SEPARATOR = ',';
const WILDCARD_ORIGIN = '*';
const HTTPS_PREFIX = 'https://';

export interface Config {
  port: number;
  corsOrigins: string[];
  nodeEnv: string;
}

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(CORS_ORIGIN_SEPARATOR)
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

function assertProductionCorsOrigin(origin: string): void {
  if (origin === WILDCARD_ORIGIN) {
    throw new Error('CORS_ORIGIN must not contain "*" in production');
  }
  if (origin.endsWith('/')) {
    throw new Error(`CORS_ORIGIN must not have a trailing slash: ${origin}`);
  }
  if (origin === LOCAL_DEV_CORS_ORIGIN) {
    throw new Error('CORS_ORIGIN must not be the local development default in production');
  }
  if (!origin.startsWith(HTTPS_PREFIX)) {
    throw new Error(`CORS_ORIGIN must use https in production: ${origin}`);
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = env.PORT ? Number(env.PORT) : 3001;
  const nodeEnv = env.NODE_ENV ?? 'development';
  const parsedOrigins = parseCorsOrigins(env.CORS_ORIGIN ?? '');

  let corsOrigins = parsedOrigins;
  if (nodeEnv === PRODUCTION_NODE_ENV) {
    if (parsedOrigins.length === 0) {
      throw new Error('CORS_ORIGIN must be set in production');
    }
    parsedOrigins.forEach(assertProductionCorsOrigin);
  } else if (parsedOrigins.length === 0) {
    // An empty list would block every cross-origin request, so running
    // without a .env falls back to the local Vite dev server.
    corsOrigins = [LOCAL_DEV_CORS_ORIGIN];
  }

  return { port, corsOrigins, nodeEnv };
}
