import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import {
  CreateSessionResponseSchema,
  ErrorResponseSchema,
  GetSessionResponseSchema,
} from '../src/schemas.js';
import { endSession, resetSessionStore } from '../src/sessionStore.js';
import { PointSystemType } from '../src/types.js';

const testConfig: Config = {
  port: 0,
  corsOrigins: ['http://localhost:5173'],
  nodeEnv: 'test',
};

beforeEach(() => {
  resetSessionStore();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /healthz', () => {
  it('returns 200', async () => {
    const app = createApp(testConfig);
    const response = await request(app).get('/healthz');
    expect(response.status).toBe(200);
  });
});

describe('POST /sessions', () => {
  it('creates a numerical session', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });

    expect(response.status).toBe(201);
    const body = CreateSessionResponseSchema.parse(response.body);
    expect(body.pointSystem.axisValues).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.adminName).toBe('Jim');
  });

  it('creates a fibonacci session', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Fibonacci,
      sliderMax: 10,
    });

    expect(response.status).toBe(201);
    const body = CreateSessionResponseSchema.parse(response.body);
    expect(body.pointSystem.axisValues).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it('rejects a name carrying a symbol as INVALID_NAME', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim@Bob',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_NAME');
  });

  it('accepts a name with an embedded space', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'jim bob',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });

    expect(response.status).toBe(201);
    const body = CreateSessionResponseSchema.parse(response.body);
    expect(body.adminName).toBe('Jim Bob');
  });

  it('rejects an over-ceiling sliderMax as INVALID_SLIDER_MAX', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 21,
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_SLIDER_MAX');
  });

  it('rejects a missing adminName as INVALID_REQUEST', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_REQUEST');
  });

  it('names every invalid field in one readable message, not a JSON blob of issues', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      pointSystemType: PointSystemType.Numerical,
      sliderMax: '5',
    });

    const body = ErrorResponseSchema.parse(response.body);
    expect(body.message).toBe(
      'adminName: Invalid input: expected string, received undefined; sliderMax: Invalid input: expected number, received string',
    );
  });

  it('rejects a sliderMax sent as a string as INVALID_REQUEST', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: '5',
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_REQUEST');
  });

  it('rejects a pointSystemType outside the enum as INVALID_REQUEST', async () => {
    const app = createApp(testConfig);
    const response = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: 'tshirt',
      sliderMax: 5,
    });

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_REQUEST');
  });
});

describe('request body limits', () => {
  const JSON_BODY_LIMIT_BYTES = 8 * 1024;

  // A valid body padded to exactly `totalBytes`. The extra key is ignored, so
  // only the size can cause a rejection.
  function paddedBody(totalBytes: number): string {
    const base = { adminName: 'Jim', pointSystemType: PointSystemType.Numerical, sliderMax: 5 };
    const overhead = JSON.stringify({ ...base, padding: '' }).length;
    const body = JSON.stringify({ ...base, padding: 'x'.repeat(totalBytes - overhead) });
    expect(body.length).toBe(totalBytes);
    return body;
  }

  it('accepts a body of exactly 8kb', async () => {
    const app = createApp(testConfig);
    const response = await request(app)
      .post('/sessions')
      .set('Content-Type', 'application/json')
      .send(paddedBody(JSON_BODY_LIMIT_BYTES));

    expect(response.status).toBe(201);
  });

  it('rejects a body one byte over 8kb as INVALID_REQUEST, not a 500', async () => {
    const app = createApp(testConfig);
    const response = await request(app)
      .post('/sessions')
      .set('Content-Type', 'application/json')
      .send(paddedBody(JSON_BODY_LIMIT_BYTES + 1));

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_REQUEST');
  });

  it('rejects malformed JSON as INVALID_REQUEST, not a 500', async () => {
    const app = createApp(testConfig);
    const response = await request(app)
      .post('/sessions')
      .set('Content-Type', 'application/json')
      .send('{"adminName": "Jim",');

    expect(response.status).toBe(400);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('INVALID_REQUEST');
  });
});

describe('security headers', () => {
  it('sends helmet headers and no x-powered-by', async () => {
    const app = createApp(testConfig);
    const response = await request(app).get('/healthz');

    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
});

describe('GET /sessions/:id', () => {
  it('returns the in-progress session without a reveal or adminToken', async () => {
    const app = createApp(testConfig);
    const createdResponse = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const created = CreateSessionResponseSchema.parse(createdResponse.body);

    const response = await request(app).get(`/sessions/${created.sessionId}`);

    expect(response.status).toBe(200);
    const body = GetSessionResponseSchema.parse(response.body);
    expect(body.ended).toBe(false);
    expect(body.reveal).toBeUndefined();
    expect((response.body as Record<string, unknown>).adminToken).toBeUndefined();
  });

  it('returns the ended session with a reveal', async () => {
    const app = createApp(testConfig);
    const createdResponse = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const created = CreateSessionResponseSchema.parse(createdResponse.body);
    endSession(created.sessionId, created.adminToken);

    const response = await request(app).get(`/sessions/${created.sessionId}`);

    expect(response.status).toBe(200);
    const body = GetSessionResponseSchema.parse(response.body);
    expect(body.ended).toBe(true);
    expect(body.reveal).toBeDefined();
    expect((response.body as Record<string, unknown>).adminToken).toBeUndefined();
  });

  // An expired session is deleted outright, so over REST it is exactly the
  // 404 an id that never existed gets — no "expired" variant to tell apart.
  it('returns 404 UNKNOWN_SESSION once the session has expired', async () => {
    const app = createApp(testConfig);
    const createdResponse = await request(app).post('/sessions').send({
      adminName: 'Jim',
      pointSystemType: PointSystemType.Numerical,
      sliderMax: 5,
    });
    const created = CreateSessionResponseSchema.parse(createdResponse.body);
    const justPastOpenTtl = new Date(Date.now() + 90 * 60 * 1000 + 1);

    // Only Date is faked — supertest still needs its real timers.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(justPastOpenTtl);
    const response = await request(app).get(`/sessions/${created.sessionId}`);

    expect(response.status).toBe(404);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('UNKNOWN_SESSION');
  });

  it('returns 404 UNKNOWN_SESSION for an id that was never created', async () => {
    const app = createApp(testConfig);
    const response = await request(app).get('/sessions/this-session-id-does-not-exist');

    expect(response.status).toBe(404);
    const body = ErrorResponseSchema.parse(response.body);
    expect(body.error).toBe('UNKNOWN_SESSION');
  });
});

describe('unmatched route', () => {
  it('does not return 200', async () => {
    const app = createApp(testConfig);
    const response = await request(app).get('/this-route-does-not-exist');
    expect(response.status).not.toBe(200);
  });
});
