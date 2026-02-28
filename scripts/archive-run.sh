#!/usr/bin/env bash
# archive-run.sh — Copy current screenshots into a timestamped run folder with metadata.
#
# Usage: bash scripts/archive-run.sh <label>
#   label: short task name (e.g. "fix-upper-thigh-gap")
#
# Creates: screenshots/runs/<timestamp>_<slug>/
#   - Copies all PNGs from screenshots/
#   - Writes run.md with metadata
#   - Appends row to screenshots/runs/index.md
#   - Prints the run directory path to stdout

set -euo pipefail

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/archive-run.sh <label>" >&2
  exit 1
fi

LABEL="$1"
SLUG=$(echo "$LABEL" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9-]/-/g' | sed 's/--*/-/g' | sed 's/^-//;s/-$//')
TIMESTAMP=$(date +%Y-%m-%dT%H-%M-%S)
FOLDER_NAME="${TIMESTAMP}_${SLUG}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCREENSHOTS_DIR="$PROJECT_ROOT/screenshots"
RUNS_DIR="$SCREENSHOTS_DIR/runs"
RUN_DIR="$RUNS_DIR/$FOLDER_NAME"

# Check that there are screenshots to archive
PNG_COUNT=$(find "$SCREENSHOTS_DIR" -maxdepth 1 -name "*.png" 2>/dev/null | wc -l | tr -d ' ')
if [ "$PNG_COUNT" -eq 0 ]; then
  echo "No PNG files found in screenshots/. Nothing to archive." >&2
  exit 1
fi

# Create run directory
mkdir -p "$RUN_DIR"

# Copy all PNGs from screenshots/ (not from subdirs)
for png in "$SCREENSHOTS_DIR"/*.png; do
  [ -f "$png" ] || continue
  # Strip the "human-male-" prefix and "-test" suffix for cleaner names
  BASENAME=$(basename "$png")
  CLEAN_NAME=$(echo "$BASENAME" | sed 's/^human-male-//' | sed 's/-test\.png$/.png/')
  cp "$png" "$RUN_DIR/$CLEAN_NAME"
done

ARCHIVED_COUNT=$(find "$RUN_DIR" -name "*.png" | wc -l | tr -d ' ')

# Gather metadata
GIT_HEAD=$(git -C "$PROJECT_ROOT" rev-parse --short HEAD 2>/dev/null || echo "unknown")
GIT_BRANCH=$(git -C "$PROJECT_ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")
DIFF_STAT=$(git -C "$PROJECT_ROOT" diff --stat 2>/dev/null || echo "(no changes)")

# Write run.md
cat > "$RUN_DIR/run.md" << EOF
# Run: $LABEL

- **Timestamp:** $(date +%Y-%m-%dT%H:%M:%S)
- **Git HEAD:** $GIT_HEAD ($GIT_BRANCH)
- **Label:** $LABEL
- **Screenshots:** $ARCHIVED_COUNT files

## Diff stat

\`\`\`
$DIFF_STAT
\`\`\`

## Verdict

_(pending — will be appended by visual-eval)_
EOF

# Create or append to index.md
INDEX_FILE="$RUNS_DIR/index.md"
if [ ! -f "$INDEX_FILE" ]; then
  cat > "$INDEX_FILE" << 'EOF'
# Screenshot Archive Index

| Timestamp | Label | Commit | Screenshots | Verdict |
|-----------|-------|--------|-------------|---------|
EOF
fi

echo "| $TIMESTAMP | $LABEL | $GIT_HEAD | $ARCHIVED_COUNT | pending |" >> "$INDEX_FILE"

# Print the run directory (relative to project root) for callers to capture
REL_PATH="screenshots/runs/$FOLDER_NAME"
echo "$REL_PATH"
