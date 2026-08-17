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
