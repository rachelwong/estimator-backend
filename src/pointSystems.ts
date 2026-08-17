import { AppError, ErrorCode } from './errors.js';
import { PointSystemType } from './types.js';

export const FIBONACCI_SEQUENCE = [0, 1, 2, 3, 5, 8, 13, 21, 34, 55];

const SLIDER_MAX_CEILING: Record<PointSystemType, number> = {
  [PointSystemType.Numerical]: 20,
  [PointSystemType.Fibonacci]: 64,
};

export function validateSliderMax(type: PointSystemType, sliderMax: number): void {
  const ceiling = SLIDER_MAX_CEILING[type];
  if (ceiling === undefined) {
    throw new AppError(ErrorCode.InvalidSliderMax, `Unknown point system type: ${type}`);
  }
  if (!Number.isInteger(sliderMax) || sliderMax < 0 || sliderMax > ceiling) {
    throw new AppError(
      ErrorCode.InvalidSliderMax,
      `sliderMax must be an integer between 0 and ${ceiling} for type "${type}"`,
    );
  }
}

export function computeAxisValues(type: PointSystemType, sliderMax: number): number[] {
  validateSliderMax(type, sliderMax);
  if (type === PointSystemType.Numerical) {
    return Array.from({ length: sliderMax + 1 }, (_, i) => i);
  }
  return FIBONACCI_SEQUENCE.filter((value) => value <= sliderMax);
}
