import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LOCAL_DEV_CORS_ORIGIN, loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  it('defaults port to 3001 when PORT is unset', () => {
    const config = loadConfig({ CORS_ORIGIN: 'https://example.com', NODE_ENV: 'development' });
    expect(config.port).toBe(3001);
  });

  it('reads PORT, CORS_ORIGIN, and NODE_ENV from the given env', () => {
    const config = loadConfig({
      PORT: '4000',
      CORS_ORIGIN: 'https://example.com',
      NODE_ENV: 'development',
    });
    expect(config.port).toBe(4000);
    expect(config.corsOrigin).toBe('https://example.com');
    expect(config.nodeEnv).toBe('development');
  });

  it('throws in production when CORS_ORIGIN is unset', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/CORS_ORIGIN/);
  });

  it('throws in production when CORS_ORIGIN has a trailing slash', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://example.com/' }),
    ).toThrow(/trailing slash/);
  });

  it('throws in production when CORS_ORIGIN is the local dev default', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'http://localhost:5173' }),
    ).toThrow(/local development/);
  });

  it('does not throw in production for a valid CORS_ORIGIN', () => {
    expect(() =>
      loadConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://example.com' }),
    ).not.toThrow();
  });

  it('does not throw when CORS_ORIGIN is unset outside production', () => {
    expect(() => loadConfig({ NODE_ENV: 'development' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'test' })).not.toThrow();
    expect(() => loadConfig({})).not.toThrow();
  });
});

describe('LOCAL_DEV_CORS_ORIGIN', () => {
  it('matches the CORS_ORIGIN default documented in .env.example', () => {
    const envExample = readFileSync(new URL('../.env.example', import.meta.url), 'utf-8');
    const match = envExample.match(/^CORS_ORIGIN=(.+)$/m);
    expect(match?.[1]).toBe(LOCAL_DEV_CORS_ORIGIN);
  });
});
