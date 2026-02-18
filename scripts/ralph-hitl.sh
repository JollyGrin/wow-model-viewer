#!/usr/bin/env bash
set -euo pipefail

SCOPE="${1:-ralph-scope.md}"
PROGRESS="ralph-progress.md"

# Initialize progress file if missing
[ -f "$PROGRESS" ] || echo "# Ralph Progress Log" > "$PROGRESS"

claude -p "$(cat <<EOF
@${SCOPE} @${PROGRESS}

You are running in Ralph Wiggum mode (HITL — human is watching).

1. Read the scope file and progress file.
2. Pick the SINGLE highest-priority incomplete task.
3. Implement it with minimal code changes.
4. Run /e2e-eval to validate any visual changes. If the eval fails 3 times, record what you tried and move on.
5. Run: tsc --noEmit && bun run build
   If either fails, fix and retry.
6. Append what you did to ${PROGRESS} with format:
   ## [date] Task: <name>
   - Status: done|blocked|skipped
   - Files changed: <list>
   - Notes: <what happened>
7. Stage changed files and commit with a descriptive message.
8. If ALL tasks in scope are done, output: <promise>COMPLETE</promise>

Work on exactly ONE task, then stop.
EOF
)"

echo "--- HITL iteration complete ---"
