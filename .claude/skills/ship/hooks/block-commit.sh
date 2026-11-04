#!/bin/bash
# PreToolUse hook for /ship. Rachel commits and pushes her own changes, so Claude never runs either.
# Same file in estimator-backend and both estimator-frontend branches. Keep all copies in sync.

GIT_COMMIT_OR_PUSH='\bgit\b.*\b(commit|push)\b'

command=$(jq -r '.tool_input.command // empty')

if grep -Eq "$GIT_COMMIT_OR_PUSH" <<<"$command"; then
  echo "Blocked: Rachel commits and pushes her own changes. Leave them uncommitted and suggest a commit message instead." >&2
  exit 2
fi

exit 0
