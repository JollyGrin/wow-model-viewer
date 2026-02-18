#!/usr/bin/env bash
set -euo pipefail

ITERATIONS="${1:-5}"
SCOPE="${2:-ralph-scope.md}"
PROGRESS="ralph-progress.md"

[ -f "$PROGRESS" ] || echo "# Ralph Progress Log" > "$PROGRESS"

echo "Starting Ralph AFK: ${ITERATIONS} iterations, scope=${SCOPE}"

for ((i=1; i<=ITERATIONS; i++)); do
  echo ""
  echo "=== Ralph iteration ${i}/${ITERATIONS} ==="
  echo ""

  result=$(claude -p "$(cat <<EOF
@${SCOPE} @${PROGRESS}

You are running in Ralph Wiggum mode (AFK — iteration ${i}/${ITERATIONS}).

1. Read the scope file and progress file.
2. Pick the SINGLE highest-priority incomplete task.
3. Implement it with minimal code changes.
4. Run /e2e-eval to validate any visual changes. If the eval fails 3 times, record what you tried and move on.
5. Run: tsc --noEmit && bun run build
   If either fails, fix and retry (max 3 attempts). If still broken, revert and move to next task.
6. Append what you did to ${PROGRESS}.
7. Stage changed files and commit.
8. If ALL tasks in scope are done, output: <promise>COMPLETE</promise>

Work on exactly ONE task, then stop.
EOF
)")

  echo "$result"

  if echo "$result" | grep -q '<promise>COMPLETE</promise>'; then
    echo ""
    echo "=== All tasks complete after ${i} iterations ==="
    exit 0
  fi
done

echo ""
echo "=== Ralph finished ${ITERATIONS} iterations ==="
