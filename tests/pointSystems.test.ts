import { describe, expect, it } from 'vitest';
import { computeAxisValues, validateSliderMax } from '../src/pointSystems.js';
import { expectAppError } from './helpers.js';

describe('computeAxisValues', () => {
  it('fibonacci: sliderMax at the exact top of the sequence (55) returns the full sequence', () => {
    expect(computeAxisValues('fibonacci', 55)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
  });

  it('numerical: builds every integer from 0 to sliderMax inclusive', () => {
    expect(computeAxisValues('numerical', 5)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('fibonacci: a between-fib sliderMax (10) filters down to the nearest values below it', () => {
    expect(computeAxisValues('fibonacci', 10)).toEqual([0, 1, 2, 3, 5, 8]);
  });

  it('fibonacci: sliderMax at the slider ceiling (64) still tops out at 55, not just below 64', () => {
    expect(computeAxisValues('fibonacci', 64)).toEqual([0, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
  });

  it('fibonacci: sliderMax of 0 degenerates to a single-value axis', () => {
    expect(computeAxisValues('fibonacci', 0)).toEqual([0]);
  });

  it('numerical: sliderMax of 0 degenerates to a single-value axis', () => {
    expect(computeAxisValues('numerical', 0)).toEqual([0]);
  });

  it('numerical: sliderMax at the slider ceiling (20) builds the full 0..20 range', () => {
    // Hand-typed literal, not Array.from(...) — an independent expected value,
    // not the same construction formula the implementation itself uses.
    expect(computeAxisValues('numerical', 20)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it('rejects a type outside numerical/fibonacci instead of silently defaulting to fibonacci', () => {
    // @ts-expect-error -- forging a bad type, mirroring an untrusted REST/WS payload
    expectAppError(() => computeAxisValues('tshirt', 5), 'INVALID_SLIDER_MAX');
  });

  it('rejects a negative sliderMax instead of silently returning an empty array', () => {
    expectAppError(() => computeAxisValues('numerical', -5), 'INVALID_SLIDER_MAX');
  });
});

describe('validateSliderMax', () => {
  it('rejects a numerical sliderMax above the 20 ceiling', () => {
    expectAppError(() => validateSliderMax('numerical', 21), 'INVALID_SLIDER_MAX');
  });

  it('accepts a numerical sliderMax at the 20 ceiling', () => {
    expect(() => validateSliderMax('numerical', 20)).not.toThrow();
  });

  it('rejects a fibonacci sliderMax above the 64 ceiling', () => {
    expectAppError(() => validateSliderMax('fibonacci', 65), 'INVALID_SLIDER_MAX');
  });

  it('accepts a fibonacci sliderMax at the 64 ceiling', () => {
    expect(() => validateSliderMax('fibonacci', 64)).not.toThrow();
  });

  it('rejects a negative sliderMax', () => {
    expectAppError(() => validateSliderMax('numerical', -1), 'INVALID_SLIDER_MAX');
  });

  it('rejects a non-integer sliderMax', () => {
    expectAppError(() => validateSliderMax('numerical', 5.5), 'INVALID_SLIDER_MAX');
  });

  it('rejects a type outside numerical/fibonacci', () => {
    // @ts-expect-error -- forging a bad type, mirroring an untrusted REST/WS payload
    expectAppError(() => validateSliderMax('tshirt', 5), 'INVALID_SLIDER_MAX');
  });
});
