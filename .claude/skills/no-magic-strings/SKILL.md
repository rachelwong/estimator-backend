---
name: no-magic-strings
description: Production-code convention for this repo — a fixed set of string literals used as a discriminant (===, Record/object key, or a parameter restricted to a known set) must be defined once as a const object with the union type derived from it, then referenced by name at call sites, never retyped as a literal. Use when writing or reviewing any src/ file that introduces a new type/status/kind/code field, or that compares a value against one of a known set of strings.
---

Two rules, one pattern, learned from `src/types.ts`/`src/pointSystems.ts` (`PointSystemType`) and `src/errors.ts` (`ErrorCode`) — the same shape applied twice in this repo.

## Define the constant once, derive the type, use the accessor everywhere

Don't declare a string union and then retype its members as literals at every comparison/lookup site (`type === 'numerical'`, `{ numerical: 20, fibonacci: 64 }`). Define a `const` object first and derive the union type from its values instead:

```ts
export const PointSystemType = {
  Numerical: 'numerical',
  Fibonacci: 'fibonacci',
} as const;

export type PointSystemType = (typeof PointSystemType)[keyof typeof PointSystemType];
```

Then reference `PointSystemType.Numerical`, never `'numerical'`, in application code — as `Record` keys (`[PointSystemType.Numerical]: 20`), in comparisons (`type === PointSystemType.Numerical`), and as arguments (`new AppError(ErrorCode.InvalidSliderMax, ...)`).

**Why**: a literal retyped at N call sites has N chances to typo, and even when TypeScript catches the typo (because the parameter is already narrowed to the union), the literal still isn't rename-safe or autocomplete-discoverable the way `Thing.Member` is. The const object is the single source of truth; the type and every call site derive from it.

This applies even when the literal is already SCREAMING_SNAKE_CASE and looks constant-ish (`'INVALID_SLIDER_MAX'`, as in `ErrorCode`) — the same drift risk exists, just with lower type-safety cost since a typo there is still caught by the union-typed parameter.

## Does not apply to `tests/`

`.claude/skills/test-conventions/SKILL.md` deliberately wants test files to hand-type raw literals (`'numerical'`, `'INVALID_SLIDER_MAX'`) as expected values, independent of the implementation's constants — that independence is what makes the assertion a real check rather than the same claim written twice. Don't "fix" test literals by swapping in the production constant; that would undermine the rule the other skill exists to enforce.

## Centralizing doesn't help when the duplicate is outside the module graph

This skill's fix (const object, single import) only works when every duplicate site can `import` the constant. Some duplicates can't — a value also hardcoded in `.env.example`, a YAML config, a README, or an external dashboard setting has no TS-side file that reaches it, so moving the constant into a shared `constants.ts` changes nothing about the actual drift risk.

**What to do instead**: write a test that reads both sources at runtime and asserts they agree (e.g. `readFileSync('.env.example')`, parse the relevant line, compare against the exported constant) — see `src/config.ts`'s `LOCAL_DEV_CORS_ORIGIN` / `tests/config.test.ts`. This converts "someone might forget to update both" into a failing `npm test` the moment they diverge, which centralizing can't do for a file outside the module graph.
