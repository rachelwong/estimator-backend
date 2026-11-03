import type { Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect } from 'vitest';
import { AppError, type ErrorCode } from '../src/errors.js';

export function expectAppError(fn: () => unknown, code: ErrorCode): void {
  try {
    fn();
    expect.unreachable(`Expected an AppError with code "${code}" to be thrown`);
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
  }
}

// Test servers listen on 127.0.0.1 only. On macOS, a server on every address
// can get a port another app (e.g. VS Code) already holds on 127.0.0.1.
// Requests then reach that app instead, and tests flake with a 404.
const TEST_HOST = '127.0.0.1';

// Starts the server on a free 127.0.0.1 port and returns its base URL.
export async function listenOnTestHost(server: HttpServer): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, TEST_HOST, resolve));
  return `http://${TEST_HOST}:${(server.address() as AddressInfo).port}`;
}
