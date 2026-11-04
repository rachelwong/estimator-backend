#!/bin/bash
# Stop hook for /ship. Exit 2 blocks Claude from finishing and sends stderr back to it.
# Checks every estimator checkout with uncommitted code changes, not just the one the session started in:
# the backend, the frontend (release/design) and the frontend master worktree.
# Same file in estimator-backend and estimator-frontend. Keep both copies in sync.

MAX_BLOCKS=3
CHECKOUTS=(estimator-backend estimator-frontend estimator-frontend-master)

input=$(cat)
session_id=$(jq -r '.session_id' <<<"$input")
projects_dir=$(dirname "$CLAUDE_PROJECT_DIR")
state_dir="${TMPDIR:-/tmp}/ship-$session_id"
mkdir -p "$state_dir"

# Stop blocking after a few tries so an unfixable failure can't loop forever.
blocks=$(cat "$state_dir/blocks" 2>/dev/null || echo 0)
if ((blocks >= MAX_BLOCKS)); then
  exit 0
fi

# Runs the checks for a checkout. Remaining args are changed files to format-check (backend only).
run_checks() {
  local checkout=$1
  shift
  case "$checkout" in
    estimator-backend)
      npm run typecheck && npm run lint && npm test || return 1
      (($# == 0)) || npx prettier --check -- "$@"
      ;;
    estimator-frontend*) npx tsc -b && npm run lint ;;
  esac
}

# Blocks once per session with a reminder.
remind_once() {
  [[ -f "$state_dir/$1" ]] && return
  touch "$state_dir/$1"
  echo "$2" >&2
  exit 2
}

failures=""
code_changed=false
docs_changed=false
plan_changed=false
plans=()
code_in=" "

for checkout in "${CHECKOUTS[@]}"; do
  dir="$projects_dir/$checkout"
  [[ -e "$dir/.git" ]] || continue
  [[ -f "$dir/estimator-plan.md" ]] && plans+=("$dir/estimator-plan.md")

  changed=$(git -C "$dir" status --porcelain --untracked-files=all | cut -c4-)
  grep -q '\.md$' <<<"$changed" && docs_changed=true
  grep -qx 'estimator-plan.md' <<<"$changed" && plan_changed=true

  code=$(grep -E '^(src|tests|scripts)/.*\.(ts|tsx|mjs|js)$' <<<"$changed")
  [[ -n "$code" ]] || continue
  code_changed=true
  code_in+="$checkout "

  # Whole-repo format:check fails on old files, so only check the changed ones.
  # Kept as an array so file names are never parsed as shell.
  files=()
  while IFS= read -r f; do
    [[ -f "$dir/$f" ]] && files+=("$f")
  done <<<"$code"

  output=$(cd "$dir" && run_checks "$checkout" ${files[@]+"${files[@]}"} 2>&1)
  if (($? != 0)); then
    failures+="--- $checkout failed ---"$'\n'"$(tail -40 <<<"$output")"$'\n'
  fi
done

if [[ -n "$failures" ]]; then
  echo $((blocks + 1)) >"$state_dir/blocks"
  echo "Checks failed. Fix them before finishing /ship:" >&2
  echo "$failures" >&2
  exit 2
fi

# estimator-plan.md is the shared source of truth. Once any copy changes, all must match.
if $plan_changed; then
  for plan in "${plans[@]:1}"; do
    if ! cmp -s "${plans[0]}" "$plan"; then
      echo $((blocks + 1)) >"$state_dir/blocks"
      echo "estimator-plan.md differs between ${plans[0]} and $plan. Make every copy identical." >&2
      exit 2
    fi
  done
fi

# Reminders are judgement calls, so each blocks once and Claude can say why it doesn't apply.
# Prints the checkout name if it has code changes.
code_in() { [[ "$code_in" == *" $1 "* ]] && echo "$1"; }
backend=$(code_in estimator-backend)
design=$(code_in estimator-frontend)
master=$(code_in estimator-frontend-master)

if [[ -n "$design" && -z "$master" ]] || [[ -z "$design" && -n "$master" ]]; then
  remind_once branch-reminded "Only one frontend branch changed. Make the same functional change on the other (release/design and master), or say why it doesn't apply."
fi

if [[ -n "$backend" && -n "$design$master" ]] && ! $plan_changed; then
  remind_once plan-reminded "Code changed in both backend and frontend but estimator-plan.md didn't. Update every copy, or say why it doesn't apply."
fi

if $code_changed && ! $docs_changed; then
  remind_once docs-reminded "Code changed but no docs did. Update the docs in place (step 5 of /ship), or say why none apply."
fi

exit 0
