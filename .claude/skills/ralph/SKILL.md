---
name: ralph
description: >
  Run a single Ralph Wiggum iteration: pick a task from scope, implement it,
  validate with feedback loops, track progress, and commit.
---

# Ralph Wiggum — Single Iteration

You are inside a Ralph Wiggum autonomous iteration. Follow these steps exactly.

## Step 1 — Understand Context

Read these files:
- The scope file (passed via @mention) — defines what to build
- `ralph-progress.md` — what's been done in previous iterations

Identify the highest-priority incomplete task.

## Step 2 — Implement

Make the minimal code changes needed for ONE task. Follow existing patterns in the codebase.

Rules:
- One task per iteration. Do not scope-creep.
- Prefer editing existing files over creating new ones.
- If the task is blocked by a prerequisite, note it in progress and pick the next task.

## Step 3 — Feedback Gates

Run these checks in order. Fix and retry if they fail (max 3 attempts each).

1. **Type check:** `tsc --noEmit`
2. **Build:** `bun run build`
3. **Visual eval (if visual change):** Run `/e2e-eval`
   - If e2e-eval fails 3 times, record what you tried and mark the task as blocked.

If after 3 attempts a gate still fails, REVERT your changes and move on.

## Step 4 — Record Progress

Append to `ralph-progress.md`:

```
## [YYYY-MM-DD] Task: <name>
- Status: done | blocked | skipped
- Files changed: <list>
- Decisions: <any architectural choices made>
- Notes: <blockers, findings, or issues>
```

## Step 5 — Commit

Stage your changes (including ralph-progress.md) and commit:
```
git add <specific files>
git commit -m "<descriptive message>"
```

## Step 6 — Completion Check

If ALL tasks in the scope file are done (or blocked), output:
```
<promise>COMPLETE</promise>
```

Otherwise, stop. The next iteration will pick up where you left off.
