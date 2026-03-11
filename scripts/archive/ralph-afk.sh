#!/usr/bin/env bash
set -euo pipefail

ITERATIONS="${1:-5}"
SCOPE="${2:-ralph-scope.md}"
PROGRESS="ralph-progress.md"
FILTER="$(dirname "$0")/ralph-log-filter.py"
LOG="ralph-output.log"

if [ ! -f "$SCOPE" ]; then
  echo "ERROR: Scope file not found: $SCOPE"
  echo "Usage: ./scripts/ralph-afk.sh [iterations] [scope-file]"
  exit 1
fi

[ -f "$PROGRESS" ] || echo "# Ralph Progress Log" > "$PROGRESS"

echo "Starting Ralph AFK: ${ITERATIONS} iterations, scope=${SCOPE}"
echo "Full output logged to: ${LOG}"

for ((i=1; i<=ITERATIONS; i++)); do
  echo ""
  echo "=== Ralph iteration ${i}/${ITERATIONS} ==="
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
    cat <<PROMPT
You are running in Ralph Wiggum mode (AFK — iteration ${i}/${ITERATIONS}).

1. Read the scope and progress above. Also read any key files mentioned in the scope.
2. Pick the SINGLE highest-priority incomplete task (not already done in progress).
3. Implement it with minimal code changes.
4. Run /e2e-eval to validate any visual changes. If the eval fails 3 times, record what you tried and move on.
5. Run: tsc --noEmit && bun run build
   If either fails, fix and retry (max 3 attempts). If still broken, revert and move to next task.
6. Append what you did to ralph-progress.md.
7. Do NOT run any git commands. The human will commit manually.
8. If ALL tasks in scope are done, output: RALPH_COMPLETE

Work on exactly ONE task, then stop.
PROMPT
  } | claude -p \
    --verbose \
    --output-format stream-json \
    --include-partial-messages \
    --allowedTools "Bash(bun:*),Bash(bunx:*),Bash(npm:*),Bash(npx:*),Bash(tsc:*),Bash(node:*),Bash(ls:*),Bash(find:*),Bash(wc:*),Bash(xxd:*),Bash(sort:*),Bash(python3:*),Edit,Read,Write,Glob,Grep,Skill" \
    | tee -a "$LOG" \
    | python3 "$FILTER"

  # Check raw log for completion signal
  if tail -20 "$LOG" | grep -q 'RALPH_COMPLETE'; then
    echo ""
    echo "=== All tasks complete after ${i} iterations ==="
    exit 0
  fi
done

echo ""
echo "=== Ralph finished ${ITERATIONS} iterations ==="
