// Every regex used by production code lives here, so the patterns can be read,
// reviewed and reused in one place instead of being buried at their call sites.

// 1-20 letters, digits and single interior spaces — "Jim Bob" is a name,
// "Jim@Bob" is not. Mirrored in estimator-frontend/src/lib/validation.ts.
export const PARTICIPANT_NAME_PATTERN = /^[A-Za-z0-9]+( [A-Za-z0-9]+)*$/;

// Runs of two or more spaces, collapsed to one when a name is normalized.
export const REPEATED_SPACES_PATTERN = / +/g;

// Any run of whitespace — spaces, tabs, line breaks — collapsed to one space
// when a description is normalized, so it is always a single line.
export const WHITESPACE_RUN_PATTERN = /\s+/g;
