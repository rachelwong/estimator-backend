---
name: test-conventions
description: Test-quality conventions for this repo's vitest suites — assert specific AppError codes (not just the class), use independent literal expected values, and pair boundary rejection/acceptance tests. Use when writing or reviewing any test file in estimator-backend, especially one that asserts a thrown AppError or a computed array/object value.
---

Three rules, learned by reviewing `tests/pointSystems.test.ts` against Kent C. Dodds' testing-trophy writing and Martin Fowler's unit-test writing. Each closes a gap where a test *looked* like it verified a rule but actually didn't.

## Assert the specific error code, not just the class

`AppError` (`src/errors.ts`) is one class shared across every `ErrorCode`. `expect(() => fn()).toThrow(AppError)` only proves *some* `AppError` was thrown — it passes even if the wrong rule fired (e.g. a copy-paste bug throwing `SESSION_ENDED` where `INVALID_SLIDER_MAX` was meant). That's not a hypothetical: mutating one throw site's code in `pointSystems.ts` left every `.toThrow(AppError)` test green.

Use the shared helper instead of a bare `toThrow`:

```ts
import { expectAppError } from './helpers.js';

expectAppError(() => validateSliderMax('numerical', 21), 'INVALID_SLIDER_MAX');
```

`expectAppError` (`tests/helpers.ts`) asserts both `instanceof AppError` and the exact `.code`. Add rejection cases to it as new `ErrorCode`s appear in later steps — don't write a fresh try/catch per test file.

## Expected values must be independent of the implementation's formula

An expected value that's *computed* the same way the code computes it can't disagree with a bug in that computation — it isn't independent verification, it's the same claim written twice. Hand-type expected arrays/objects as literals instead of rebuilding them with the same helper or formula the source uses (`Array.from({ length: n }, ...)`, a shared range-builder, etc.), even when that's more typing.

## Pair a rejection test at the boundary with an acceptance test at the boundary

Off-by-one is the most likely bug at any ceiling/threshold check. Test rejection at `ceiling + 1` *and* acceptance at exactly `ceiling` — one alone leaves the boundary itself unverified. `validateSliderMax`'s tests do this correctly (`21` rejected / `20` accepted for numerical; `65` rejected / `64` accepted for fibonacci) — match that shape for every new threshold this app adds.
