#!/usr/bin/env bash
set -euo pipefail

SCOPE="${1:-ralph-scope.md}"
PROGRESS="ralph-progress.md"
FILTER="$(dirname "$0")/ralph-log-filter.py"

if [ ! -f "$SCOPE" ]; then
  echo "ERROR: Scope file not found: $SCOPE"
  echo "Create it first, or pass a path: ./scripts/ralph-hitl.sh my-scope.md"
  exit 1
fi

[ -f "$PROGRESS" ] || echo "# Ralph Progress Log" > "$PROGRESS"

echo "=== Ralph HITL: scope=$SCOPE ==="
echo "Sending prompt to Claude... (this may take 10-30s to start)"
echo ""

{
  echo "<scope>"
  cat "$SCOPE"
  echo "</scope>"
  echo ""
  echo "<progress>"
  cat "$PROGRESS"
  echo "</progress>"
  echo ""
  cat <<'PROMPT'
You are running in Ralph Wiggum mode (HITL — human is watching).

1. Read the scope and progress above. Also read any key files mentioned in the scope.
2. Pick the SINGLE highest-priority incomplete task (not already done in progress).
3. Implement it with minimal code changes.
4. Run /e2e-eval to validate any visual changes. If the eval fails 3 times, record what you tried and move on.
5. Run: tsc --noEmit && bun run build
   If either fails, fix and retry.
6. Append what you did to ralph-progress.md with format:
   ## [date] Task: <name>
   - Status: done|blocked|skipped
   - Files changed: <list>
   - Notes: <what happened>
7. If ALL tasks in scope are done, output: RALPH_COMPLETE

Work on exactly ONE task, then stop.
PROMPT
} | claude -p \
  --verbose \
  --output-format stream-json \
  --include-partial-messages \
  --allowedTools "Bash,Edit,Read,Write,Glob,Grep,Skill" \
  2>&1 \
  | python3 -u "$FILTER"

echo ""
echo "--- HITL iteration complete ---"
